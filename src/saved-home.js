import { sameUrl, savedPage } from './saved-tabs.js';

// Redirect evidence belongs to an owned instance, never to a domain or saved URL
// globally. Only verified URLs travel with that instance's recovery checkpoint.
export function savedHome(state, tabId) {
  const home = state.live.savedHomes[tabId];
  const page = savedPage(state.data, state.live.pageOwners[tabId]);
  return home && page && home.pageId === page.id && sameUrl(home.root, page.url) ? home : undefined;
}

export function observeSavedNavigation(state, type, event) {
  if (event.frameId !== 0 || (event.documentLifecycle && event.documentLifecycle !== 'active')) return false;
  const { live } = state;
  const page = savedPage(state.data, live.pageOwners[event.tabId]);
  if (!page || !state.tabs.some(tab => tab.id === event.tabId)) return false;
  const home = savedHome(state, event.tabId) ?? { pageId: page.id, root: page.url, urls: [] };
  live.savedHomes[event.tabId] = home;
  const navigation = live.homeNavigations[event.tabId] ??= { lastTime: -1 };
  if (event.timeStamp < navigation.lastTime) return false;
  navigation.lastTime = event.timeStamp;
  const atHome = url => sameUrl(page.url, url) || home.urls.some(alias => sameUrl(alias, url));

  if (type === 'before') {
    // A new navigation replaces the pending request. This deliberately declines
    // ambiguous cross-process chains rather than learning an unrelated address.
    navigation.pending = { url: event.url, timeStamp: event.timeStamp,
      earlyHome: Boolean(navigation.document?.earlyHome) };
    if (navigation.document) navigation.document.earlyHome = false;
    if (sameUrl(page.url, event.url)) home.urls = [];
  } else if (type === 'committed') {
    const pending = navigation.pending;
    const qualifiers = event.transitionQualifiers ?? [];
    const history = qualifiers.includes('forward_back');
    const automaticClient = qualifiers.includes('client_redirect') && !qualifiers.includes('from_address_bar') &&
      !['typed', 'generated', 'keyword', 'keyword_generated', 'form_submit', 'reload'].includes(event.transitionType);
    const redirected = pending && !history && (
      (atHome(pending.url) && qualifiers.includes('server_redirect')) ||
      (pending.earlyHome && automaticClient)
    );
    // No same-site guessing: query strings, fragments and cross-site destinations
    // are significant. Chrome must attest to an actual redirect from home.
    if (redirected && /^https?:\/\//i.test(event.url) && !atHome(event.url)) home.urls = [...home.urls, event.url].slice(-16);
    navigation.document = { id: event.documentId, url: event.url, earlyHome: !history && atHome(event.url) };
    delete navigation.pending;
  } else if (type === 'ready' || type === 'completed' || type === 'history' || type === 'fragment') {
    // Once the initial document is ready, later script routing is normal Away
    // navigation. Stale completion events must not end another document's load.
    if (navigation.document && event.documentId === navigation.document.id) navigation.document.earlyHome = false;
    if (type === 'history' || type === 'fragment') delete navigation.pending;
  } else if (type === 'error') {
    if (navigation.pending && sameUrl(navigation.pending.url, event.url)) delete navigation.pending;
    if (navigation.document && event.documentId === navigation.document.id) navigation.document.earlyHome = false;
  }
  return true;
}

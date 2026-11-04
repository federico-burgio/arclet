import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { pageSession } from '../src/saved-tabs.js';

const root = 'https://home.test/';
const canonical = 'https://www.home.test/start?account=1#home';
async function fixture(kind = 'pin', extra = {}) {
  const browser = fakeBrowser([tab(1, root, 0, 1, extra), tab(2, 'https://other.test/', 1)]);
  const initial = await browser.run('SAVE_PAGE', { kind, tabId: 1 });
  const page = (kind === 'pin' ? initial.pins : initial.favorites)[0];
  let timeStamp = 0;
  const event = (type, url, options = {}) => browser.controller.navigationEvent(type,
    { tabId: 1, frameId: 0, url, timeStamp: ++timeStamp, documentId: 'home-document', transitionType: 'link', ...options });
  const status = async () => pageSession(page, (await browser.run()).tabs).status;
  const redirect = async (to = canonical) => {
    await event('before', root);
    browser.change(1, { url: to });
    await event('committed', to, { transitionQualifiers: ['server_redirect'] });
    await event('completed', to);
  };
  return { browser, page, event, status, redirect };
}

for (const kind of ['pin', 'favorite']) test(`${kind}: verified HTTP redirects count as home; child pages remain Away`, async () => {
  const { browser, page, redirect, event, status } = await fixture(kind);
  await redirect();
  assert.equal(await status(), 'home');
  assert.equal((await browser.run())[kind === 'pin' ? 'pins' : 'favorites'][0].url, root);
  for (const url of [canonical + 'child', 'https://www.home.test/start?account=2#home', 'https://elsewhere.test/']) {
    await event('before', url);
    browser.change(1, { url });
    await event('committed', url, { documentId: 'child' });
    assert.equal(await status(), 'away');
  }
  browser.change(1, { url: canonical }); // Back to the verified destination.
  assert.equal(await status(), 'home');
  assert.equal((await browser.run()).tabs.find(tab => tab.id === 1).savedPageId, page.id);
});

test('a child URL that itself redirects never becomes home', async () => {
  const { browser, redirect, event, status } = await fixture();
  await redirect();
  await event('before', 'https://home.test/article');
  browser.change(1, { url: 'https://home.test/article/final' });
  await event('committed', 'https://home.test/article/final', { transitionQualifiers: ['server_redirect'] });
  assert.equal(await status(), 'away');
});

test('a URL change without redirect evidence, including a commit without a before event, stays Away', async () => {
  const { browser, event, status } = await fixture();
  browser.change(1, { url: canonical });
  await event('committed', canonical, { transitionQualifiers: ['server_redirect'] });
  assert.equal(await status(), 'away');
  await event('before', root);
  await event('committed', canonical);
  assert.equal(await status(), 'away');
});

test('early automatic client redirects are home; later script routing is Away', async () => {
  const { browser, event, status } = await fixture();
  await event('before', root);
  await event('committed', root);
  await event('before', canonical);
  browser.change(1, { url: canonical });
  await event('committed', canonical, { documentId: 'redirected', transitionQualifiers: ['client_redirect'] });
  assert.equal(await status(), 'home');
  await event('ready', canonical, { documentId: 'redirected' });
  const child = 'https://home.test/later';
  await event('before', child);
  browser.change(1, { url: child });
  await event('committed', child, { documentId: 'later', transitionQualifiers: ['client_redirect'] });
  assert.equal(await status(), 'away');
});

for (const qualifiers of [['server_redirect'], ['client_redirect', 'forward_back'], ['client_redirect', 'from_address_bar']]) {
  test(`navigation away during initial home loading stays Away: ${qualifiers.join(', ')}`, async () => {
    const { browser, event, status } = await fixture();
    await event('before', root);
    await event('committed', root);
    await event('before', canonical);
    browser.change(1, { url: canonical });
    await event('committed', canonical, { transitionQualifiers: qualifiers });
    assert.equal(await status(), 'away');
  });
}

test('SPA, fragments, and history navigation do not teach new aliases', async () => {
  const { browser, redirect, event, status } = await fixture();
  await redirect();
  for (const type of ['history', 'fragment']) {
    const url = canonical + type;
    browser.change(1, { url });
    await event(type, url);
    assert.equal(await status(), 'away');
  }
  await event('before', root);
  browser.change(1, { url: 'https://history.test/' });
  await event('committed', 'https://history.test/', { transitionQualifiers: ['server_redirect', 'forward_back'] });
  assert.equal(await status(), 'away');
});

test('failed, subframe, prerender, stale, and interrupted navigations cannot teach aliases', async () => {
  const { browser, event, status } = await fixture();
  await event('before', root);
  await event('error', root);
  browser.change(1, { url: canonical });
  await event('committed', canonical, { transitionQualifiers: ['server_redirect'] });
  assert.equal(await status(), 'away');
  for (const options of [{ frameId: 2 }, { documentLifecycle: 'prerender' }]) {
    await event('before', root, options);
    await event('committed', canonical, { ...options, transitionQualifiers: ['server_redirect'] });
    assert.equal(await status(), 'away');
  }
  await event('before', root);
  await event('before', 'https://other.test/');
  await event('committed', canonical, { transitionQualifiers: ['server_redirect'], timeStamp: 1 });
  assert.equal(await status(), 'away');
  await event('committed', canonical, { transitionQualifiers: ['server_redirect'] });
  assert.equal(await status(), 'away');
});

test('aliases survive worker suspension, unambiguous restart, replacement and restore, but not a fresh opening', async () => {
  const { browser, page, redirect } = await fixture();
  await redirect();
  browser.suspend();
  assert.equal(pageSession(page, (await browser.run()).tabs).status, 'home');
  browser.restart([tab(101, canonical)]);
  assert.equal(pageSession(page, (await browser.run()).tabs).status, 'home');
  browser.setTabs([tab(102, canonical)]);
  await browser.controller.tabReplaced(102, 101);
  assert.equal(pageSession(page, (await browser.run()).tabs).status, 'home');
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  assert.equal(pageSession(page, (await browser.run('RESTORE_TAB')).tabs).status, 'home');
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  const opened = await browser.run('OPEN_PAGE', { id: page.id });
  const instance = opened.tabs.find(tab => tab.savedPageId === page.id);
  assert.equal(instance.url, root);
  browser.change(instance.id, { url: canonical });
  assert.equal(pageSession(page, (await browser.run()).tabs).status, 'away');
});

test('aliases are private to an instance and never exported or applied to independent duplicates', async () => {
  const { browser, page, redirect } = await fixture();
  await redirect();
  browser.setTabs([tab(1, canonical), tab(2, canonical, 1), tab(3, root, 0, 2)]);
  let state = await browser.run('OPEN_PAGE', { id: page.id }, 2);
  browser.change(3, { url: canonical });
  state = await browser.run('GET_STATE', {}, 2);
  assert.equal(pageSession(page, state.tabs).status, 'away');
  assert.equal((await browser.run()).tabs.find(tab => tab.id === 2).savedPageId, null);
  const exported = (await browser.run('EXPORT_DATA')).exportDocument;
  assert.equal(JSON.stringify(exported).includes(canonical), false);
  await browser.run('REMOVE_PAGE', { kind: 'pin', id: page.id });
  assert.deepEqual(browser.live.savedHomes, {});
  assert.equal(JSON.stringify(browser.local.workspace).includes('savedHome'), false);
});

test('incognito redirect destinations stay out of the persistent checkpoint', async () => {
  const { browser, redirect } = await fixture('favorite', { incognito: true });
  await redirect();
  assert.equal(JSON.stringify(browser.local).includes(canonical), false);
  assert.equal(browser.live.savedHomes[1].urls[0], canonical);
});

test('reset learns the current redirect destination without retaining obsolete aliases', async () => {
  const { browser, page, redirect, event, status } = await fixture();
  await redirect();
  await browser.run('RESET_SAVED_PAGE', { id: page.id });
  await event('before', root);
  const updated = 'https://home.test/new-home';
  browser.change(1, { url: updated });
  await event('committed', updated, { transitionQualifiers: ['server_redirect'] });
  assert.equal(await status(), 'home');
  browser.change(1, { url: canonical });
  assert.equal(await status(), 'away');
});

test('stale completion of the previous document cannot end a new home redirect chain', async () => {
  const { browser, event, status } = await fixture();
  await event('before', root);
  await event('committed', root);
  await event('before', canonical);
  browser.change(1, { url: canonical });
  await event('committed', canonical, { documentId: 'second', transitionQualifiers: ['client_redirect'] });
  await event('completed', root); // Previous document, delivered late.
  const final = 'https://home.test/final';
  await event('before', final);
  browser.change(1, { url: final });
  await event('committed', final, { documentId: 'third', transitionQualifiers: ['client_redirect'] });
  assert.equal(await status(), 'home');
});

test('ambiguous restoration does not assign a redirect alias to either duplicate', async () => {
  const { browser, page, redirect } = await fixture();
  await redirect();
  browser.restart([tab(101, canonical), tab(102, canonical, 1)]);
  const state = await browser.run();
  assert.equal(pageSession(page, state.tabs).status, 'closed');
  assert.equal(state.tabs.some(tab => tab.savedHome), false);
});

test('a tab moved into a window with an existing instance loses its alias with ownership', async () => {
  const { browser, page, redirect } = await fixture();
  await redirect();
  browser.setTabs([tab(1, canonical), tab(2, root, 0, 2)]);
  await browser.run('OPEN_PAGE', { id: page.id }, 2);
  browser.change(1, { windowId: 2, index: 1 });
  const state = await browser.run('GET_STATE', {}, 2);
  assert.equal(state.tabs.find(tab => tab.id === 1).savedPageId, null);
  assert.equal(state.tabs.find(tab => tab.id === 1).savedHome, undefined);
  assert.equal(browser.live.savedHomes[1], undefined);
});

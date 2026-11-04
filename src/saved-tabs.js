// A saved home is stable; ownership follows the running instance, not its URL.
export const savedPages = data => [...data.favorites, ...data.pins];
export const savedPage = (data, id) => savedPages(data).find(page => page.id === id);
export function sameUrl(left, right) {
  try { return new URL(left).href === new URL(right).href; } catch { return false; }
}
export const isHome = (page, tab) => sameUrl(page.url, tab.url || tab.pendingUrl);
export const ownedTab = (state, pageId, windowId) => state.tabs.find(tab => tab.windowId === windowId && state.live.pageOwners[tab.id] === pageId);
export function pageSession(page, tabs) {
  const tab = tabs.find(tab => tab.savedPageId === page.id);
  return { tab, status: !tab ? 'closed' : isHome(page, tab) ? 'home' : 'away' };
}

export function bindSavedTab(state, page, tab) {
  const { live } = state;
  live.pageOwners[tab.id] = page.id;
  live.ownerKnown[tab.id] = true;
  live.ownerWindows[tab.id] = tab.windowId;
  live.ownerSnapshots[tab.id] = { pageId: page.id, url: tab.url || tab.pendingUrl || page.url, windowId: tab.windowId, spaceId: page.spaceId ?? live.tabSpaces[tab.id], incognito: !!tab.incognito };
  if (page.spaceId) live.tabSpaces[tab.id] = page.spaceId;
}

export function adoptableTab(state, page, windowId) {
  const candidates = state.tabs.filter(tab => tab.windowId === windowId && !state.live.pageOwners[tab.id] &&
    (!page.spaceId || state.live.tabSpaces[tab.id] === page.spaceId) && isHome(page, tab));
  return candidates.find(tab => tab.active) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

export function reconcileSavedTabs(state, tabs) {
  const { data, live } = state;
  const pages = savedPages(data);
  const byId = new Map(pages.map(page => [page.id, page]));
  if (!live.legacyOwnersInitialized) {
    if (state.workspace.savedOwnershipVersion !== 1) tabs.forEach(tab => { live.legacyOwnerCandidates[tab.id] = true; });
    live.legacyOwnerPageIds = pages.map(page => page.id);
    live.legacyOwnersInitialized = true;
  }
  state.workspace.savedOwnershipVersion = 1;
  const ids = new Set(tabs.map(tab => String(tab.id)));
  // Keep closing-window bindings until the removal handler preserves its checkpoint.
  for (const id of Object.keys(live.pageOwners)) {
    if (!byId.has(live.pageOwners[id])) { delete live.pageOwners[id]; delete live.ownerSnapshots[id]; }
  }
  const groups = new Map();
  for (const tab of tabs) {
    const page = byId.get(live.pageOwners[tab.id]);
    if (!page) continue;
    const key = `${tab.windowId}:${page.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }
  for (const group of groups.values()) {
    // An existing destination-window instance wins over an arriving tab.
    group.sort((a, b) => Number(live.ownerWindows[b.id] === b.windowId) - Number(live.ownerWindows[a.id] === a.windowId) || a.index - b.index);
    group.slice(1).forEach(tab => { delete live.pageOwners[tab.id]; delete live.ownerSnapshots[tab.id]; live.ownerKnown[tab.id] = true; });
  }
  for (const tab of tabs) {
    if (live.pageOwners[tab.id]) {
      const page = byId.get(live.pageOwners[tab.id]);
      if (page.spaceId) live.tabSpaces[tab.id] = page.spaceId;
      live.ownerWindows[tab.id] = tab.windowId;
      live.ownerSnapshots[tab.id] = { pageId: page.id, url: tab.url || tab.pendingUrl || page.url, windowId: tab.windowId, spaceId: live.tabSpaces[tab.id], incognito: !!tab.incognito };
    }
  }
  // One-time legacy adoption. Newly created or explicitly unowned tabs never
  // become saved instances merely by visiting a saved address.
  const pending = tabs.filter(tab => live.legacyOwnerCandidates[tab.id] && !live.ownerKnown[tab.id] && (tab.url || tab.pendingUrl));
  const legacyIds = new Set(live.legacyOwnerPageIds ?? []);
  for (const tab of pending) {
    const candidates = pages.filter(page => legacyIds.has(page.id) && (!page.spaceId || page.spaceId === live.tabSpaces[tab.id]) && isHome(page, tab) &&
      !tabs.some(other => other.windowId === tab.windowId && live.pageOwners[other.id] === page.id));
    if (candidates.length !== 1) continue;
    const [page] = candidates;
    const peers = pending.filter(other => other.windowId === tab.windowId && !live.pageOwners[other.id] &&
      (!page.spaceId || live.tabSpaces[other.id] === page.spaceId) && isHome(page, other));
    if (peers.length === 1 || tab.active) bindSavedTab(state, page, tab);
  }
  pending.forEach(tab => { live.ownerKnown[tab.id] = true; delete live.legacyOwnerCandidates[tab.id]; });
  tabs.filter(tab => !live.legacyOwnerCandidates[tab.id]).forEach(tab => { live.ownerKnown[tab.id] = true; });
  for (const id of Object.keys(live.ownerKnown)) {
    if (!ids.has(id) && !live.pageOwners[id]) { delete live.ownerKnown[id]; delete live.ownerWindows[id]; }
  }
}

export function clearSavedOwnership(state, pageId) {
  for (const [id, owner] of Object.entries(state.live.pageOwners)) {
    if (owner === pageId) { delete state.live.pageOwners[id]; delete state.live.ownerSnapshots[id]; state.live.ownerKnown[id] = true; }
  }
  for (const window of [...state.workspace.windows, ...state.live.recovery.windows]) {
    for (const record of window.tabs) if (record.savedPageId === pageId) record.savedPageId = null;
  }
  state.live.closedPages = state.live.closedPages.filter(record => record.pageId !== pageId);
}

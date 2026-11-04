// Chrome tab/window IDs last only for a browser session. Keep a separate checkpoint
// of URLs and tab order, and consume its records one-to-one as Chrome restores tabs.
const emptyPage = url => !url || ['about:blank', 'chrome://newtab/', 'chrome://newtab', 'chrome://new-tab-page/'].includes(url);
const urls = tab => [...new Set([tab.pendingUrl, tab.url].filter(Boolean))];
const samePage = (left, right) => urls(left).some(url => urls(right).includes(url));
const validSpace = (data, id) => data.spaces.some(space => space.id === id) ? id : data.spaces[0].id;

export function preparePersistence(state) {
  const { live, workspace } = state;
  live.tabKeys ??= {};
  live.windowKeys ??= {};
  live.fixedTabs ??= {};
  live.noRecovery ??= {};
  live.fixedWindows ??= {};
  live.closingWindows ??= {};
  if (!live.recovery) {
    live.recovery = { windows: structuredClone(workspace.windows), bindings: {}, used: {} };
    // Upgrade an already-running 0.1 browser session without losing its assignments.
    for (const id of Object.keys(live.tabSpaces)) live.fixedTabs[id] = true;
    for (const id of Object.keys(live.windowSpaces)) live.fixedWindows[id] = true;
  }
}

function overlap(current, saved) {
  if (current.every(tab => emptyPage(urls(tab)[0])) && saved.some(tab => !emptyPage(urls(tab)[0]))) return 0;
  const available = [...saved];
  let score = 0;
  for (const tab of current) {
    const index = available.findIndex(record => samePage(tab, record));
    if (index === -1) continue;
    const [record] = available.splice(index, 1);
    // Real pages identify a window much more strongly than a shared New Tab page.
    score += emptyPage(urls(tab)[0]) ? 1 : 100;
    if (Boolean(tab.pinned) === Boolean(record.pinned)) score += .1;
  }
  return score;
}

function bindWindows(state, windows) {
  const { live, workspace } = state;
  const recovery = live.recovery;
  const claimed = new Set(Object.values(recovery.bindings));
  const remaining = [...windows.keys()].filter(id => !recovery.bindings[id] && !live.closingWindows[id]);
  while (remaining.length) {
    const choices = [];
    for (const id of remaining) {
      const current = windows.get(id).filter(tab => !tab.incognito && !live.noRecovery[tab.id]);
      if (!current.length) continue;
      const candidates = recovery.windows.filter(saved => !claimed.has(saved.key))
        .map(saved => ({ id, saved, score: overlap(current, saved.tabs) }))
        .filter(candidate => candidate.score > 0)
        .sort((a, b) => b.score - a.score || b.saved.updatedAt - a.saved.updatedAt);
      if (!candidates.length) continue;
      const [best, second] = candidates;
      // Don't let an early common tab claim the wrong window while restore is partial.
      if (second && Math.abs(best.score - second.score) < .001 &&
          (current.length < best.saved.tabs.length || current.length < second.saved.tabs.length)) continue;
      choices.push(best);
    }
    choices.sort((a, b) => b.score - a.score || b.saved.updatedAt - a.saved.updatedAt);
    if (!choices.length) break;
    const { id, saved } = choices[0];
    const previousKey = live.windowKeys[id];
    if (previousKey && previousKey !== saved.key) {
      // Discard the provisional checkpoint made before this window had its URLs.
      workspace.windows = workspace.windows.filter(window => window.key !== previousKey);
    }
    recovery.bindings[id] = saved.key;
    live.windowKeys[id] = saved.key;
    if (!live.fixedWindows[id]) live.windowSpaces[id] = validSpace(state.data, saved.spaceId);
    claimed.add(saved.key);
    remaining.splice(remaining.indexOf(id), 1);
  }
}

function recoverTabs(state, id, current) {
  const { data, live } = state;
  const recovery = live.recovery;
  const saved = recovery.windows.find(window => window.key === recovery.bindings[id]);
  if (!saved) return;
  const pending = saved.tabs.filter(record => !recovery.used[record.key]);
  const candidates = current.filter(tab => !tab.incognito && !live.noRecovery[tab.id] && !recovery.used[live.tabKeys[tab.id]]);
  // Match duplicate URLs in their original order, rather than assigning every copy
  // to whichever space happened to be stored last for that URL.
  const ordered = [...pending].sort((a, b) => a.index - b.index);
  for (const record of ordered) {
    const matches = candidates.filter(tab => samePage(tab, record));
    if (!matches.length) continue;
    const duplicates = pending.filter(other => !recovery.used[other.key] && samePage(other, record));
    const unknownPages = current.some(tab => emptyPage(urls(tab)[0]) && !live.recovery.used[live.tabKeys[tab.id]] && !live.noRecovery[tab.id]);
    if (matches.length < duplicates.length && (current.length < saved.tabs.length || unknownPages)) continue;
    matches.sort((a, b) =>
      Number(Boolean(b.pinned) === Boolean(record.pinned)) - Number(Boolean(a.pinned) === Boolean(record.pinned)) ||
      Math.abs(a.index - record.index) - Math.abs(b.index - record.index) || a.index - b.index);
    const tab = matches[0];
    live.tabKeys[tab.id] = record.key;
    if (!live.fixedTabs[tab.id]) live.tabSpaces[tab.id] = validSpace(data, record.spaceId);
    recovery.used[record.key] = true;
    candidates.splice(candidates.indexOf(tab), 1);
  }
}

export function reconcileWorkspace(state, tabs) {
  preparePersistence(state);
  const { data, live, workspace } = state;
  const windows = new Map();
  for (const tab of tabs) {
    if (live.closingWindows[tab.windowId]) continue;
    if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
    windows.get(tab.windowId).push(tab);
  }
  for (const current of windows.values()) current.sort((a, b) => a.index - b.index);
  bindWindows(state, windows);
  for (const [id, current] of windows) {
    recoverTabs(state, id, current);
    live.windowKeys[id] ??= crypto.randomUUID();
    for (const tab of current) {
      live.tabKeys[tab.id] ??= crypto.randomUUID();
      live.tabSpaces[tab.id] = validSpace(data, live.tabSpaces[tab.id] ?? live.tabSpaces[tab.openerTabId] ?? live.windowSpaces[id]);
    }
    live.windowSpaces[id] = validSpace(data, live.windowSpaces[id]);
    // Never put incognito URLs into persistent storage, even if the extension is
    // explicitly enabled in a private window.
    const records = current.filter(tab => !tab.incognito).map(tab => ({
      key: live.tabKeys[tab.id], spaceId: live.tabSpaces[tab.id],
      url: tab.url || '', ...(tab.pendingUrl ? { pendingUrl: tab.pendingUrl } : {}),
      index: tab.index, pinned: Boolean(tab.pinned)
    }));
    if (!records.length) continue;
    const saved = live.recovery.windows.find(window => window.key === live.recovery.bindings[id]);
    // Keep unconsumed records while Chrome is restoring tabs incrementally.
    const waiting = saved?.tabs.filter(record => !live.recovery.used[record.key]) ?? [];
    const checkpoint = { key: live.windowKeys[id], spaceId: live.windowSpaces[id], updatedAt: Date.now(),
      tabs: [...records, ...waiting.map(record => ({ ...record, spaceId: validSpace(data, record.spaceId) }))] };
    const index = workspace.windows.findIndex(window => window.key === checkpoint.key);
    if (index < 0) workspace.windows.push(checkpoint);
    else workspace.windows[index] = checkpoint;
  }
  // Keep missing/closing windows intact: Chrome can emit removal events during
  // shutdown. A shutdown event must never erase the checkpoint being restored.
  // A moved tab can outlive its old window. Retire its record from that window
  // so the next restart has exactly one checkpoint record for each live tab.
  const owners = new Map();
  for (const [id, current] of windows) {
    for (const tab of current) if (!tab.incognito) owners.set(live.tabKeys[tab.id], live.windowKeys[id]);
  }
  for (const window of workspace.windows) {
    window.tabs = window.tabs.filter(record => !owners.has(record.key) || owners.get(record.key) === window.key);
  }
  workspace.windows = workspace.windows.filter(window => window.tabs.length);
  const activeKeys = new Set([...windows.keys()].map(id => live.windowKeys[id]));
  const recent = workspace.windows.filter(window => !activeKeys.has(window.key))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  workspace.windows = [...workspace.windows.filter(window => activeKeys.has(window.key)), ...recent];
}

export function forgetTab(state, id) {
  const key = state.live.tabKeys[id];
  if (key) {
    for (const window of state.workspace.windows) window.tabs = window.tabs.filter(record => record.key !== key);
    state.live.recovery.used[key] = true;
  }
  delete state.live.tabSpaces[id];
  delete state.live.tabKeys[id];
  delete state.live.fixedTabs[id];
  delete state.live.noRecovery[id];
}

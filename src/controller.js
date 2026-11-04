import { COLORS, DEFAULT_FAVORITES_PER_ROW, MAX_FAVORITES_PER_ROW, FONT_SCALES, DEFAULT_FONT_SCALE, defaultData, destination, safeSavedUrl, iconAppearance, openTabsForSpace } from './model.js';
import { preparePersistence, reconcileWorkspace, forgetTab } from './persistence.js';
import { normalizePinnedOrder, movePinnedItem, pinnedEntries, removePinnedFolder } from './pinned-order.js';
import { exportData, importToken, planImport } from './transfer.js';

// The worker is the only writer. Serialize commands and tab events across every open panel.
export function createController(api, notify = () => {}) {
  let tail = Promise.resolve();
  const queue = task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };

  async function load() {
    const [local, checkpoint, session] = await Promise.all([
      api.storage.local.get('data'), api.storage.local.get('workspace'), api.storage.session.get('live')
    ]);
    const data = local.data ?? defaultData();
    data.backgroundColor ??= null;
    data.showSearchBar ??= true;
    data.pageControlsPosition ??= 'left';
    data.showFavoriteLabels ??= true;
    data.favoritesPerRow ??= DEFAULT_FAVORITES_PER_ROW;
    data.fontScale ??= DEFAULT_FONT_SCALE;
    data.folders ??= [];
    normalizePinnedOrder(data);
    const live = session.live ?? { tabSpaces: {}, windowSpaces: {} };
    const state = { data, live, workspace: checkpoint.workspace ?? { version: 1, windows: [] } };
    preparePersistence(state);
    return state;
  }

  const save = async ({ data, live, workspace }) => {
    normalizePinnedOrder(data);
    await api.storage.local.set({ data, workspace });
    await api.storage.session.set({ live });
  };
  async function synchronize(state) {
    state.tabs = await api.tabs.query({});
    reconcileWorkspace(state, state.tabs);
  }
  const requireSpace = (data, id) => {
    const space = data.spaces.find(space => space.id === id);
    if (!space) throw new Error('This space no longer exists.');
    return space;
  };
  const selectedSpace = (data, live, windowId) =>
    data.spaces.find(space => space.id === live.windowSpaces[windowId])?.id ?? data.spaces[0].id;

  function getState(windowId, state) {
    const { data, live } = state;
    const tabs = state.tabs.filter(tab => tab.windowId === windowId);
    const spaceId = selectedSpace(data, live, windowId);
    return { ...data, spaceId, tabs: tabs.map(tab => ({ ...tab, spaceId: live.tabSpaces[tab.id] })) };
  }

  async function run(message) {
    const { type, windowId, payload = {} } = message;
    if (!Number.isInteger(windowId)) throw new Error('A browser window is required.');
    const state = await load();
    await synchronize(state);
    const { data, live } = state;
    const spaceId = selectedSpace(data, live, windowId);

    // Commands may only act on tabs in the requesting panel's window.
    async function tabInWindow(id) {
      const tab = await api.tabs.get(id);
      if (tab.windowId !== windowId) throw new Error('This tab belongs to another window.');
      return tab;
    }
    async function createTab(url, targetSpace = spaceId) {
      requireSpace(data, targetSpace);
      const tab = await api.tabs.create({ windowId, url, active: true });
      live.tabSpaces[tab.id] = targetSpace;
      live.windowSpaces[windowId] = targetSpace;
      live.fixedTabs[tab.id] = true;
      live.noRecovery[tab.id] = true;
      return tab;
    }

    switch (type) {
      case 'EXPORT_DATA':
        return { ...getState(windowId, state), exportDocument: exportData(data) };
      case 'PREVIEW_IMPORT': {
        const plan = planImport(data, payload.document);
        return { ...getState(windowId, state), importPreview: { ...plan.summary, token: await importToken(data) } };
      }
      case 'IMPORT_DATA': {
        if (typeof payload.token !== 'string' || payload.token !== await importToken(data)) {
          throw new Error('Your sidebar changed since the preview. Choose the file again to review the import.');
        }
        const plan = planImport(data, payload.document, payload.applySettings ?? false);
        state.data = plan.data;
        break;
      }
      case 'GET_STATE':
        await save(state);
        return getState(windowId, state);
      case 'SELECT_SPACE':
        requireSpace(data, payload.id);
        live.windowSpaces[windowId] = payload.id;
        live.fixedWindows[windowId] = true;
        break;
      case 'SAVE_SPACE': {
        const name = String(payload.name ?? '').trim().slice(0, 32);
        if (!name) throw new Error('Give your space a name.');
        if (!Object.hasOwn(COLORS, payload.color)) throw new Error('Choose a space color.');
        const existing = payload.id ? requireSpace(data, payload.id) : null;
        const backgroundColor = payload.backgroundColor === undefined ? existing?.backgroundColor ?? null : payload.backgroundColor;
        if (backgroundColor !== null && (typeof backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(backgroundColor))) {
          throw new Error('Choose a valid space background color, or use a palette.');
        }
        const background = { backgroundColor: backgroundColor?.toLowerCase() ?? null };
        const appearance = iconAppearance(payload);
        if (existing) Object.assign(existing, { name, color: payload.color, ...background, ...appearance });
        else {
          if (data.spaces.length >= 12) throw new Error('You can have up to 12 spaces.');
          const id = crypto.randomUUID();
          data.spaces.push({ id, name, color: payload.color, ...background, ...appearance });
          live.windowSpaces[windowId] = id;
          live.fixedWindows[windowId] = true;
        }
        break;
      }
      case 'DELETE_SPACE': {
        requireSpace(data, payload.id);
        if (data.spaces.length === 1) throw new Error('Keep at least one space.');
        data.spaces = data.spaces.filter(space => space.id !== payload.id);
        const fallback = data.spaces[0].id;
        const existing = pinnedEntries(data, fallback).length;
        pinnedEntries(data, payload.id).forEach(({ item }, index) => { item.order = existing + index; });
        for (const [id, space] of Object.entries(live.tabSpaces)) if (space === payload.id) live.tabSpaces[id] = fallback;
        for (const [id, space] of Object.entries(live.windowSpaces)) if (space === payload.id) live.windowSpaces[id] = fallback;
        data.pins.forEach(pin => { if (pin.spaceId === payload.id) pin.spaceId = fallback; });
        data.folders.forEach(folder => { if (folder.spaceId === payload.id) folder.spaceId = fallback; });
        break;
      }
      case 'SAVE_FOLDER': {
        const folder = payload.id ? data.folders.find(item => item.id === payload.id) : null;
        if (payload.id && !folder) throw new Error('This folder no longer exists.');
        const targetSpace = folder?.spaceId ?? payload.spaceId ?? spaceId;
        requireSpace(data, targetSpace);
        const name = String(payload.name ?? '').trim().slice(0, 64);
        if (!name) throw new Error('Give your folder a name.');
        const appearance = iconAppearance(payload);
        const pin = payload.pageId ? data.pins.find(page => page.id === payload.pageId) : null;
        if (payload.pageId && (!pin || pin.spaceId !== targetSpace)) throw new Error('Choose a pinned page in this space.');
        if (folder) Object.assign(folder, { name, ...appearance });
        else {
          const id = crypto.randomUUID();
          data.folders.push({ id, name, spaceId: targetSpace, collapsed: false, ...appearance });
          if (pin) pin.folderId = id;
        }
        break;
      }
      case 'TOGGLE_FOLDER': {
        const folder = data.folders.find(item => item.id === payload.id);
        if (!folder) throw new Error('This folder no longer exists.');
        folder.collapsed = !folder.collapsed;
        break;
      }
      case 'DELETE_FOLDER':
        removePinnedFolder(data, payload.id);
        break;
      case 'MOVE_PIN':
        movePinnedItem(data, { ...payload, kind: 'pin' });
        break;
      case 'MOVE_PINNED': {
        movePinnedItem(data, payload);
        break;
      }
      case 'SET_PAGE_ICON': {
        const list = payload.kind === 'favorite' ? data.favorites : data.pins;
        const page = list.find(page => page.id === payload.id);
        if (!page) throw new Error('This saved page no longer exists.');
        Object.assign(page, iconAppearance(payload, true));
        break;
      }
      case 'NEW_TAB': await createTab(destination(payload.input ?? ''), payload.spaceId ?? spaceId); break;
      case 'ACTIVATE_TAB': {
        const tab = await tabInWindow(payload.id);
        await api.tabs.update(tab.id, { active: true });
        live.windowSpaces[windowId] = live.tabSpaces[tab.id] ?? spaceId;
        break;
      }
      case 'CLOSE_TAB':
        await tabInWindow(payload.id);
        await api.tabs.remove(payload.id);
        forgetTab(state, payload.id);
        break;
      case 'CLOSE_REGULAR_TAB': {
        const tab = await tabInWindow(payload.id);
        const visible = openTabsForSpace(getState(windowId, state).tabs, data.pins, live.tabSpaces[tab.id], data.favorites);
        if (tab.pinned || !visible.some(item => item.id === tab.id)) {
          throw new Error('Pinned and favorite tabs cannot be closed with middle-click.');
        }
        await api.tabs.remove(tab.id);
        forgetTab(state, tab.id);
        break;
      }
      case 'RELOAD_ACTIVE_TAB': {
        const tab = state.tabs.find(tab => tab.windowId === windowId && tab.active);
        if (!tab) throw new Error('Open a page first.');
        await api.tabs.reload(tab.id);
        break;
      }
      case 'NAVIGATE_ACTIVE_TAB': {
        if (!['back', 'forward'].includes(payload.direction)) throw new Error('Choose Back or Forward.');
        const tab = state.tabs.find(tab => tab.windowId === windowId && tab.active);
        if (!tab) throw new Error('Open a page first.');
        if (payload.direction === 'back') await api.tabs.goBack(tab.id);
        else await api.tabs.goForward(tab.id);
        break;
      }
      case 'CLOSE_OPEN_TABS': {
        if (!['all', 'below', 'regular'].includes(payload.mode)) throw new Error('Choose which open tabs to close.');
        const targetSpace = payload.spaceId ?? spaceId;
        requireSpace(data, targetSpace);
        const tabs = getState(windowId, state).tabs;
        let targets = openTabsForSpace(tabs, data.pins, targetSpace, data.favorites);
        if (payload.mode === 'regular') targets = targets.filter(tab => !tab.pinned);
        if (payload.mode === 'below') {
          await tabInWindow(payload.id);
          const index = targets.findIndex(tab => tab.id === payload.id);
          if (index < 0) throw new Error('This tab is no longer in the open-tab list.');
          targets = targets.slice(index + 1);
        }
        if (targets.length) {
          await api.tabs.remove(targets.map(tab => tab.id));
          targets.forEach(tab => forgetTab(state, tab.id));
        }
        break;
      }
      case 'REORDER_FAVORITE': {
        if (!['before', 'after'].includes(payload.placement)) throw new Error('Choose a valid drop position.');
        const source = data.favorites.findIndex(page => page.id === payload.id);
        const target = data.favorites.findIndex(page => page.id === payload.targetId);
        if (source < 0 || target < 0) throw new Error('This favorite no longer exists.');
        if (source === target) break;
        const [favorite] = data.favorites.splice(source, 1);
        const index = data.favorites.findIndex(page => page.id === payload.targetId) + (payload.placement === 'after' ? 1 : 0);
        data.favorites.splice(index, 0, favorite);
        break;
      }
      case 'MUTE_TAB': {
        const tab = await tabInWindow(payload.id);
        await api.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
        break;
      }
      case 'MOVE_TAB':
        await tabInWindow(payload.id);
        requireSpace(data, payload.spaceId);
        live.tabSpaces[payload.id] = payload.spaceId;
        live.fixedTabs[payload.id] = true;
        break;
      case 'REORDER_TAB': {
        const tab = await tabInWindow(payload.id);
        const target = await tabInWindow(payload.targetId);
        if (tab.pinned !== target.pinned) throw new Error('Chrome pinned tabs stay before other tabs.');
        await api.tabs.move(tab.id, { index: target.index });
        break;
      }
      case 'SAVE_PAGE': {
        let source;
        if (payload.kind === 'favorite' && payload.pageId) {
          source = data.pins.find(page => page.id === payload.pageId);
          if (!source) throw new Error('This pinned page no longer exists.');
        } else source = await tabInWindow(payload.tabId);
        const url = safeSavedUrl(source.url || source.pendingUrl);
        const list = payload.kind === 'favorite' ? data.favorites : data.pins;
        const targetSpace = payload.spaceId ?? spaceId;
        requireSpace(data, targetSpace);
        let folder;
        if (payload.kind !== 'favorite' && payload.folderId != null) {
          folder = data.folders.find(item => item.id === payload.folderId && item.spaceId === targetSpace);
          if (!folder) throw new Error('Choose a folder in the same space.');
        }
        if (list.some(page => page.url === url && (payload.kind === 'favorite' || page.spaceId === targetSpace))) {
          throw new Error('This page is already saved here.');
        }
        const page = { id: crypto.randomUUID(), url, title: (source.title || new URL(url).hostname).slice(0, 200),
          ...(source.icon ? iconAppearance(source, true) : {}),
          ...(payload.kind === 'favorite' ? {} : { spaceId: targetSpace, ...(folder ? { folderId: folder.id } : {}) }) };
        list.push(page);
        if (payload.kind !== 'favorite' && payload.targetId != null) {
          movePinnedItem(data, { kind: 'pin', id: page.id, folderId: folder?.id ?? null,
            targetId: payload.targetId, targetKind: payload.targetKind, placement: payload.placement });
        }
        if (folder) folder.collapsed = false;
        break;
      }
      case 'REMOVE_PAGE': {
        const key = payload.kind === 'favorite' ? 'favorites' : 'pins';
        data[key] = data[key].filter(page => page.id !== payload.id);
        break;
      }
      case 'OPEN_PAGE': {
        const page = [...data.favorites, ...data.pins].find(page => page.id === payload.id);
        if (!page) throw new Error('This page is no longer saved.');
        const url = safeSavedUrl(page.url);
        const tabs = await api.tabs.query({ windowId });
        const targetSpace = page.spaceId ?? spaceId;
        const existing = tabs.find(tab => tab.url === url &&
          (live.tabSpaces[tab.id] ?? spaceId) === targetSpace);
        if (existing) {
          await api.tabs.update(existing.id, { active: true });
          live.windowSpaces[windowId] = targetSpace;
        } else await createTab(url, targetSpace);
        break;
      }
      case 'RESTORE_TAB': {
        const sessions = await api.sessions.getRecentlyClosed({ maxResults: 25 });
        const recent = sessions.find(item => item.tab?.sessionId);
        if (!recent) throw new Error('No recently closed tabs to restore.');
        const restored = await api.sessions.restore(recent.tab.sessionId);
        // Restore can select a different window; move only the requested restored tab here.
        if (restored.tab) {
          const id = restored.tab.id;
          if (restored.tab.windowId !== windowId) await api.tabs.move(id, { windowId, index: -1 });
          await api.tabs.update(id, { active: true });
          live.tabSpaces[id] = spaceId;
          live.fixedTabs[id] = true;
          live.noRecovery[id] = true;
        }
        break;
      }
      case 'SET_THEME':
        if (!['system', 'light', 'dark'].includes(payload.theme)) throw new Error('Choose a valid theme.');
        data.theme = payload.theme;
        break;
      case 'SET_BACKGROUND_COLOR':
        if (payload.color !== null && (typeof payload.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(payload.color))) {
          throw new Error('Choose a valid background color, or use the theme default.');
        }
        data.backgroundColor = payload.color?.toLowerCase() ?? null;
        break;
      case 'SET_PAGE_CONTROLS_POSITION':
        if (!['left', 'right'].includes(payload.position)) throw new Error('Choose left or right for the page controls.');
        data.pageControlsPosition = payload.position;
        break;
      case 'SET_SEARCH_VISIBILITY':
        if (typeof payload.visible !== 'boolean') throw new Error('Choose whether to show the search bar.');
        data.showSearchBar = payload.visible;
        break;
      case 'SET_FAVORITE_LABELS':
        if (typeof payload.visible !== 'boolean') throw new Error('Choose whether to show favorite labels.');
        data.showFavoriteLabels = payload.visible;
        break;
      case 'SET_FAVORITES_PER_ROW':
        if (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > MAX_FAVORITES_PER_ROW) {
          throw new Error(`Choose between 1 and ${MAX_FAVORITES_PER_ROW} favorites per row.`);
        }
        data.favoritesPerRow = payload.count;
        break;
      case 'SET_FONT_SCALE':
        if (!FONT_SCALES.includes(payload.scale)) throw new Error('Choose a font size from the list.');
        data.fontScale = payload.scale;
        break;
      default: throw new Error('Unknown sidebar command.');
    }
    await synchronize(state);
    await save(state);
    notify();
    return getState(windowId, state);
  }

  return {
    initialize: () => queue(async () => {
      const state = await load();
      await synchronize(state);
      await save(state);
      notify();
    }),
    dispatch: message => queue(() => run(message)),
    tabCreated: tab => queue(async () => {
      const state = await load();
      if (tab.openerTabId && state.live.tabKeys[tab.openerTabId]) {
        state.live.noRecovery[tab.id] = true;
        state.live.tabSpaces[tab.id] ??= state.live.tabSpaces[tab.openerTabId];
      }
      await synchronize(state);
      await save(state);
      notify();
    }),
    tabRemoved: (id, info = {}) => queue(async () => {
      const state = await load();
      if (info.isWindowClosing) {
        state.live.closingWindows[info.windowId] = true;
        delete state.live.tabSpaces[id];
        delete state.live.tabKeys[id];
        delete state.live.fixedTabs[id];
        delete state.live.noRecovery[id];
      } else forgetTab(state, id);
      await synchronize(state);
      await save(state);
      notify();
    }),
    tabReplaced: (added, removed) => queue(async () => {
      const state = await load();
      if (state.live.tabSpaces[removed]) state.live.tabSpaces[added] = state.live.tabSpaces[removed];
      for (const key of ['tabKeys', 'fixedTabs', 'noRecovery']) {
        if (state.live[key][removed]) state.live[key][added] = state.live[key][removed];
        delete state.live[key][removed];
      }
      delete state.live.tabSpaces[removed];
      await synchronize(state);
      await save(state);
      notify();
    }),
    windowRemoved: id => queue(async () => {
      const state = await load();
      state.live.closingWindows[id] = true;
      delete state.live.windowSpaces[id];
      await synchronize(state);
      await save(state);
    }),
    tabActivated: ({ tabId, windowId }) => queue(async () => {
      const state = await load();
      await synchronize(state);
      const spaceId = state.live.tabSpaces[tabId];
      if (state.data.spaces.some(space => space.id === spaceId)) {
        state.live.windowSpaces[windowId] = spaceId;
      }
      await synchronize(state);
      await save(state);
      notify();
    }),
    tabsChanged: () => queue(async () => {
      const state = await load();
      await synchronize(state);
      await save(state);
      notify();
    })
  };
}

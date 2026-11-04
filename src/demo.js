import { defaultData } from './model.js';

// Explicit preview mode only. Real extension pages always use chrome.* via the worker.
export function createDemoApi() {
  const event = () => {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) };
  };
  const created = event();
  const removed = event();
  const local = { data: defaultData() };
  const session = { live: { tabSpaces: { 1: 'personal', 2: 'personal', 3: 'personal', 4: 'personal', 5: 'work', 6: 'work' }, windowSpaces: { 1: 'personal' } } };
  local.data.favorites = [
    { id: 'github', title: 'GitHub', url: 'https://github.com/' },
    { id: 'gmail', title: 'Gmail', url: 'https://mail.google.com/' },
    { id: 'notion', title: 'Notion', url: 'https://www.notion.so/' }
  ];
  local.data.pins = [
    { id: 'design', title: 'A little inspiration', url: 'https://www.are.na/', spaceId: 'personal' },
    { id: 'notes', title: 'Notes & passing thoughts', url: 'https://www.notion.so/notes', spaceId: 'personal' }
  ];
  let tabs = [
    { id: 1, title: 'A space for good ideas', url: 'https://www.are.na/', active: true },
    { id: 2, title: 'The Creative Independent', url: 'https://thecreativeindependent.com/' },
    { id: 3, title: 'Sunday kind of feeling', url: 'https://open.spotify.com/', audible: true },
    { id: 4, title: 'Read something wonderful', url: 'https://read.cv/' },
    { id: 5, title: 'Chrome Extensions — documentation', url: 'https://developer.chrome.com/docs/extensions/' },
    { id: 6, title: 'Arclet · Design explorations', url: 'https://www.figma.com/' }
  ].map((tab, index) => ({ active: false, pinned: false, mutedInfo: { muted: false }, status: 'complete', windowId: 1, index, ...tab }));
  let nextId = 7;
  const closed = [];
  const clone = value => structuredClone(value);
  const storage = store => ({
    get: async key => ({ [key]: clone(store[key]) }),
    set: async values => Object.assign(store, clone(values))
  });
  const find = id => {
    const tab = tabs.find(tab => tab.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}.`);
    return tab;
  };
  const reindex = () => tabs.forEach((tab, index) => { tab.index = index; });
  const api = {
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      onCreated: created, onRemoved: removed,
      query: async ({ windowId } = {}) => clone(tabs.filter(tab => windowId === undefined || tab.windowId === windowId)),
      get: async id => clone(find(id)),
      create: async ({ windowId, url, active }) => {
        if (active) tabs.filter(tab => tab.windowId === windowId).forEach(tab => { tab.active = false; });
        const tab = { id: nextId++, windowId, url, title: url === 'chrome://newtab/' ? 'New tab' : new URL(url).hostname, active, pinned: false, mutedInfo: { muted: false }, status: 'complete', index: tabs.length };
        tabs.push(tab);
        created.emit(clone(tab));
        return clone(tab);
      },
      update: async (id, change) => {
        const tab = find(id);
        if (change.active) tabs.filter(other => other.windowId === tab.windowId).forEach(other => { other.active = false; });
        if ('muted' in change) tab.mutedInfo = { muted: change.muted };
        if ('active' in change) tab.active = change.active;
        return clone(tab);
      },
      remove: async id => {
        const tab = find(id);
        closed.unshift({ tab: { ...clone(tab), sessionId: String(id) } });
        tabs = tabs.filter(other => other.id !== id);
        if (tab.active) {
          const next = tabs.find(other => other.windowId === tab.windowId);
          if (next) next.active = true;
        }
        reindex();
        removed.emit(id);
      },
      move: async (id, { index, windowId }) => {
        const tab = find(id);
        tabs = tabs.filter(other => other.id !== id);
        if (windowId !== undefined) tab.windowId = windowId;
        tabs.splice(index < 0 ? tabs.length : index, 0, tab);
        reindex();
        return clone(tab);
      }
    },
    sessions: {
      getRecentlyClosed: async () => clone(closed),
      restore: async sessionId => {
        const index = closed.findIndex(item => item.tab.sessionId === sessionId);
        if (index < 0) throw new Error('No tab to restore.');
        const old = closed.splice(index, 1)[0].tab;
        const tab = await api.tabs.create({ windowId: old.windowId, url: old.url, active: true });
        find(tab.id).title = old.title;
        return { tab: clone(find(tab.id)) };
      }
    }
  };
  return api;
}

import { defaultData } from '../src/model.js';
import { createController } from '../src/controller.js';

export function fakeBrowser(initial = []) {
  const clone = value => structuredClone(value);
  const local = { data: defaultData() };
  let session = {};
  let current = clone(initial);
  let nextId = 1000;
  const closed = [];
  const storage = store => ({ get: async key => ({ [key]: clone(store()[key]) }), set: async values => Object.assign(store(), clone(values)) });
  const find = id => { const tab = current.find(tab => tab.id === id); if (!tab) throw new Error('No such tab'); return tab; };
  const reindex = () => {
    const indices = {};
    current.forEach(tab => { tab.index = indices[tab.windowId] ?? 0; indices[tab.windowId] = tab.index + 1; });
  };
  const api = {
    storage: { local: storage(() => local), session: storage(() => session) },
    tabs: {
      query: async ({ windowId } = {}) => clone(current.filter(tab => windowId === undefined || tab.windowId === windowId)),
      get: async id => clone(find(id)),
      create: async ({ url, windowId, active }) => {
        if (active) current.filter(tab => tab.windowId === windowId).forEach(tab => { tab.active = false; });
        const tab = { id: nextId++, windowId, url, active, title: url, pinned: false, index: current.filter(tab => tab.windowId === windowId).length };
        current.push(tab); return clone(tab);
      },
      update: async (id, change) => {
        const tab = find(id);
        if (change.active) current.filter(other => other.windowId === tab.windowId).forEach(other => { other.active = false; });
        if ('muted' in change) tab.mutedInfo = { muted: change.muted };
        if ('active' in change) tab.active = change.active;
        return clone(tab);
      },
      remove: async id => { closed.unshift(clone(find(id))); current = current.filter(tab => tab.id !== id); reindex(); },
      move: async (id, { index, windowId }) => {
        const tab = find(id);
        current = current.filter(tab => tab.id !== id);
        if (windowId !== undefined) tab.windowId = windowId;
        const windowTabs = current.filter(other => other.windowId === tab.windowId);
        const before = index >= 0 ? windowTabs[index] : undefined;
        current.splice(before ? current.indexOf(before) : current.length, 0, tab);
        reindex(); return clone(tab);
      }
    },
    sessions: {
      getRecentlyClosed: async () => closed.map(tab => ({ tab: { ...clone(tab), sessionId: String(tab.id) } })),
      restore: async id => {
        const index = closed.findIndex(tab => String(tab.id) === id);
        const [tab] = closed.splice(index, 1);
        return { tab: await api.tabs.create({ ...tab, active: true }) };
      }
    }
  };
  let controller = createController(api);
  return {
    api, local, get live() { return session.live; }, get controller() { return controller; },
    run: (type = 'GET_STATE', payload = {}, windowId = 1) => controller.dispatch({ type, payload, windowId }),
    setTabs: tabs => { current = clone(tabs); },
    change: (id, values) => Object.assign(find(id), clone(values)),
    restart: tabs => { current = clone(tabs); session = {}; controller = createController(api); },
    suspend: () => { controller = createController(api); }
  };
}

export function tab(id, url, index = 0, windowId = 1, extra = {}) {
  return { id, url, index, windowId, title: url, pinned: false, active: index === 0, ...extra };
}

export async function connect() {
  if (globalThis.chrome?.runtime?.id) {
    const window = await chrome.windows.getCurrent();
    return {
      demo: false,
      openOptions: () => chrome.runtime.openOptionsPage(),
      async request(type, payload = {}) {
        const response = await chrome.runtime.sendMessage({ type, payload, windowId: window.id });
        if (!response?.ok) throw new Error(response?.error || 'The extension reloaded. Close and reopen the sidebar.');
        return response.state;
      },
      subscribe(listener) {
        chrome.runtime.onMessage.addListener(message => { if (message.type === 'STATE_CHANGED') listener(); });
      },
      favicon(url) {
        const path = new URL(chrome.runtime.getURL('_favicon/'));
        path.searchParams.set('pageUrl', url);
        path.searchParams.set('size', '32');
        return path.href;
      }
    };
  }
  if (new URLSearchParams(location.search).has('demo')) {
    const { createDemoApi } = await import('./demo.js');
    const { createController } = await import('./controller.js');
    const listeners = new Set();
    const channel = new BroadcastChannel('arclet-preview');
    const emit = () => listeners.forEach(listener => listener());
    const notify = () => { emit(); channel.postMessage('STATE_CHANGED'); };
    channel.addEventListener('message', emit);
    const api = createDemoApi({ savedDataStore: {
      get: () => JSON.parse(localStorage.getItem('arclet-preview-data') || 'null'),
      set: data => localStorage.setItem('arclet-preview-data', JSON.stringify(data))
    } });
    const controller = createController(api, notify);
    api.tabs.onCreated.addListener(tab => controller.tabCreated(tab));
    api.tabs.onRemoved.addListener(id => controller.tabRemoved(id));
    return { demo: true,
      openOptions() {
        const page = window.open('options.html?demo=1', 'arclet-options');
        if (!page) throw new Error('Allow this preview to open the settings tab.');
        page.focus();
      },
      request: (type, payload = {}) => controller.dispatch({ type, payload, windowId: 1 }),
      subscribe: listener => listeners.add(listener), favicon: () => null };
  }
  throw new Error('Load this folder as an unpacked Chrome extension, or use ?demo=1 for a preview.');
}

export async function connect() {
  if (globalThis.chrome?.runtime?.id) {
    const window = await chrome.windows.getCurrent();
    return {
      demo: false,
      async openOptions(section) {
        await chrome.runtime.openOptionsPage();
        if (section) {
          const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('options.html') });
          if (tabs[0]) await chrome.tabs.update(tabs[0].id, { url: `${chrome.runtime.getURL('options.html')}#${section}` });
        }
      },
      async request(type, payload = {}) {
        // Request directly from the menu click, before any asynchronous work can
        // consume Chrome's user gesture. Already-granted access prompts no more.
        if (type === 'RESTORE_TAB' && !await chrome.permissions.request({ permissions: ['sessions'] })) {
          throw new Error('Recently closed tab access was not allowed. You can try Restore again whenever you choose.');
        }
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

    const api = createDemoApi({ savedDataStore: {
      get: () => JSON.parse(localStorage.getItem('arclet-preview-data') || 'null'),
      set: data => localStorage.setItem('arclet-preview-data', JSON.stringify(data))
    }, savedStateStore: { get: () => JSON.parse(localStorage.getItem('arclet-preview-sync-local') || '{}'),
      set: value => localStorage.setItem('arclet-preview-sync-local', JSON.stringify(value)) },
    syncStore: { get: () => JSON.parse(localStorage.getItem('arclet-preview-sync') || '{}'),
      set: value => localStorage.setItem('arclet-preview-sync', JSON.stringify(value)) } });
    const controller = createController(api, notify);
    channel.addEventListener('message', event => {
      if (event.data === 'SYNC_CHANGED') controller.syncChanged().catch(() => {});
      else emit();
    });
    api.storage.onChanged.addListener((_changes, area) => {
      if (area === 'sync') { channel.postMessage('SYNC_CHANGED'); controller.syncChanged().catch(() => {}); }
    });
    api.tabs.onCreated.addListener(tab => controller.tabCreated(tab));
    api.tabs.onRemoved.addListener(id => controller.tabRemoved(id));
    return { demo: true,
      openOptions(section) {
        const page = window.open(`options.html?demo=1${section ? `#${section}` : ''}`, 'arclet-options');
        if (!page) throw new Error('Allow this preview to open the settings tab.');
        page.focus();
      },
      request: (type, payload = {}) => controller.dispatch({ type, payload, windowId: 1 }),
      subscribe: listener => listeners.add(listener), favicon: () => null };
  }
  throw new Error('Load this folder as an unpacked Chrome extension, or use ?demo=1 for a preview.');
}

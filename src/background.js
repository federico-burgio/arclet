import { createController } from './controller.js';
import { canHandleMessage } from './message-access.js';

function notify() {
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED' }).catch(() => {});
}

const controller = createController(chrome, notify);
const configure = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
configure();
chrome.runtime.onInstalled.addListener(configure);
chrome.runtime.onStartup.addListener(configure);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!canHandleMessage(chrome.runtime, message, sender)) return;
  controller.dispatch(message).then(
    state => respond({ ok: true, state }),
    error => respond({ ok: false, error: error.message })
  );
  return true;
});

const safely = operation => operation.catch(console.error);
chrome.tabs.onCreated.addListener(tab => safely(controller.tabCreated(tab)));
chrome.tabs.onRemoved.addListener((id, info) => safely(controller.tabRemoved(id, info)));
chrome.tabs.onReplaced.addListener((added, removed) => safely(controller.tabReplaced(added, removed)));
chrome.windows.onRemoved.addListener(id => safely(controller.windowRemoved(id)));
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (['url', 'pendingUrl', 'pinned'].some(key => key in change)) safely(controller.tabsChanged());
  else if (['title', 'status', 'audible', 'mutedInfo', 'favIconUrl', 'discarded'].some(key => key in change)) notify();
});
chrome.tabs.onActivated.addListener(info => safely(controller.tabActivated(info)));
chrome.tabs.onMoved.addListener(() => safely(controller.tabsChanged()));
chrome.tabs.onAttached.addListener(() => safely(controller.tabsChanged()));
chrome.tabs.onDetached.addListener(notify);
safely(controller.initialize());

const OPTIONS_COMMANDS = new Set([
  'ASSESS_SYNC', 'ENABLE_SYNC', 'DISABLE_SYNC', 'RETRY_SYNC', 'EXPORT_SYNC_BACKUP',
  'SET_TOOLBAR_MODE', 'SET_HOME_URL', 'SET_CONTROL_FAVORITE_URL',
  'GET_STATE', 'SET_THEME', 'SET_BACKGROUND_COLOR', 'SET_FONT_SCALE',
  'SET_SEARCH_VISIBILITY', 'SET_FAVORITE_LABELS', 'SET_FAVORITES_PER_ROW',
  'SET_PAGE_CONTROLS_POSITION',
  'PREVIEW_IMPORT', 'IMPORT_DATA', 'EXPORT_DATA'
]);

// Only our own UI documents can issue commands. Settings cannot perform tab actions.
export function canHandleMessage(runtime, message, sender) {
  if (sender.id !== runtime.id || !sender.url || !message || message.type === 'STATE_CHANGED') return false;
  let url;
  try { url = new URL(sender.url); } catch { return false; }
  url.hash = '';
  if (url.href === runtime.getURL('sidepanel.html')) return true;
  return url.href === runtime.getURL('options.html') && OPTIONS_COMMANDS.has(message.type);
}

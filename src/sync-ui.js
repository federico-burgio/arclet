export const syncPercent = sync => Math.round(sync.used / sync.limit * 100);
export const syncUsage = sync => `${(sync.used / 1024).toFixed(1)} KB of ${sync.limit / 1024} KB (${syncPercent(sync)}%)`;
export function syncStatus(sync) {
  if (sync.error) return sync.error;
  if (!sync.enabled) return 'Off on this device. Your configuration is stored locally.';
  if (sync.pending) return 'Changes are saved locally and waiting to be written to Chrome Sync.';
  return 'Saved to Chrome’s Sync storage. Cross-device delivery depends on your Chrome Sync settings.';
}

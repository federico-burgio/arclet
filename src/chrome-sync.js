import { SYNC_LIMIT, storageBytes, assessSync, capacityMessage, packSync, readSync, fingerprint, syncData } from './sync-format.js';

const contentHash = data => fingerprint(JSON.stringify(syncData(data)));
const summary = data => ({ spaces: data.spaces.length, folders: data.folders.length, pins: data.pins.length, favorites: data.favorites.length });

// Only called from the controller's single-writer queue. The enable preference,
// last accepted revision, pending work and recovery copy stay on this device.
export function createChromeSync(api, { load, save, synchronize, notify }) {
  const available = () => typeof api.storage.sync.get === 'function';
  async function remote() {
    if (!available()) throw new Error('Chrome Sync storage is unavailable. Your configuration remains local.');
    return readSync(await api.storage.sync.get(null));
  }
  async function assessment(state) {
    const local = assessSync(state.data);
    const cloud = await remote();
    return { ...local, incomplete: !!cloud?.incomplete, message: capacityMessage(local), remote: cloud && !cloud.incomplete ? { ...summary(cloud.data), updatedAt: cloud.head.updatedAt } : null,
      token: await fingerprint({ data: syncData(state.data), head: cloud?.head ?? null, enabled: !!state.syncPrefs.enabled }), cloud };
  }
  function preserve(state) {
    state.syncBackup = { savedAt: new Date().toISOString(), data: structuredClone(state.data) };
    state.backupChanged = true;
  }
  async function adopt(state, cloud) {
    preserve(state);
    state.data = cloud.data;
    state.fromSync = true;
    Object.assign(state.syncPrefs, { revision: cloud.head.revision, content: cloud.head.hash,
      pending: false, conflict: false, error: null, updatedAt: cloud.head.updatedAt });
  }
  async function enable(state, payload) {
    const review = await assessment(state);
    if (payload.token !== review.token) throw new Error('Your local or Chrome configuration changed. Review Sync again before enabling.');
    if (!review.fits) throw new Error(review.message);
    if (!['local', 'remote'].includes(payload.source) || (payload.source === 'remote' && (!review.cloud || review.cloud.incomplete))) throw new Error('Choose which configuration to use.');
    if (payload.source === 'remote') await adopt(state, review.cloud);
    else if (review.cloud?.data) {
      state.syncBackup = { savedAt: new Date().toISOString(), data: structuredClone(review.cloud.data) };
      state.backupChanged = true;
    }
    Object.assign(state.syncPrefs, { enabled: true, device: state.syncPrefs.device ?? crypto.randomUUID(),
      revision: review.cloud?.head.revision ?? null, content: review.cloud?.head.hash ?? null,
      pending: payload.source === 'local', conflict: false, error: null,
      repair: review.incomplete ? await fingerprint(review.cloud.head) : null });
  }
  async function pull(state) {
    if (!state.syncPrefs.enabled) return;
    try {
      const cloud = await remote();
      if (cloud?.incomplete) {
        if (state.syncPrefs.repair === await fingerprint(cloud.head)) { state.syncPrefs.error = null; return; }
        state.syncPrefs.error = 'Chrome is receiving configuration changes. Your local copy is safe. Retry shortly.';
      } else if (!cloud) {
        if (!state.syncPrefs.revision) state.syncPrefs.error = null;
        if (state.syncPrefs.revision) {
          state.syncPrefs.conflict = true;
          state.syncPrefs.error = 'The Chrome copy is missing. Review Sync before uploading this device’s configuration again.';
        }
      } else if (cloud.head.revision === state.syncPrefs.revision) {
        if (!state.syncPrefs.conflict) state.syncPrefs.error = null;
      } else if (cloud.head.device === state.syncPrefs.device && cloud.head.hash === await contentHash(state.data)) {
        Object.assign(state.syncPrefs, { revision: cloud.head.revision, content: cloud.head.hash, pending: false, error: null });
      } else if (state.syncPrefs.conflict || state.syncPrefs.pending || cloud.head.parent !== state.syncPrefs.revision) {
        state.syncPrefs.conflict = true;
        state.syncPrefs.error = 'Another device has a different configuration. Both copies are kept; review which one to use in Settings → Sync.';
      } else await adopt(state, cloud);
    } catch (error) { state.syncPrefs.error = error.message; }
  }
  async function receive() {
    const state = await load();
    if (!state.syncPrefs.enabled) return;
    await synchronize(state);
    await pull(state);
    await synchronize(state);
    await save(state);
    notify();
  }
  async function flush() {
    const state = await load();
    const prefs = state.syncPrefs;
    if (!prefs.enabled || !prefs.pending || prefs.conflict) return;
    await synchronize(state);
    try {
      const check = assessSync(state.data);
      if (!check.fits) throw new Error(capacityMessage(check));
      await pull(state);
      if (prefs.conflict || prefs.error || !prefs.pending) {
        await save(state); notify(); return;
      }
      const revision = crypto.randomUUID();
      const entries = packSync(state.data, { revision, parent: prefs.revision ?? null, device: prefs.device,
        updatedAt: new Date().toISOString(), hash: await contentHash(state.data) });
      // One replacement batch. Receiving devices validate the complete snapshot's
      // hash, since Chrome may deliver individual keys out of order across devices.
      if (storageBytes(entries) > SYNC_LIMIT) throw new Error('This upload exceeds the 80 KB Sync limit. Disable Sync explicitly before using a larger configuration.');
      await api.storage.sync.set(entries);
      const after = await api.storage.sync.get(null);
      const verified = await readSync(after);
      if (!verified || verified.incomplete || verified.head.revision !== revision) {
        prefs.conflict = true;
        throw new Error('Chrome changed during this upload. Your local configuration is safe; review Sync before continuing.');
      }
      Object.assign(prefs, { revision, content: verified.head.hash, pending: false, error: null, repair: null, updatedAt: verified.head.updatedAt });
    } catch (error) { prefs.error = `${error.message} Changes remain saved on this device. Retry from Settings → Sync.`; }
    await save(state);
    notify();
  }
  return { available, assessment, enable, pull, receive, flush };
}

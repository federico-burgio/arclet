import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { defaultData } from '../src/model.js';
import { normalizeStoredData } from '../src/stored-data.js';
import { SYNC_HEAD, SYNC_LIMIT, SYNC_PREFIX, assessSync, capacityMessage, fingerprint, packSync, readSync, storageBytes, syncData } from '../src/sync-format.js';

const makeData = (count = 1, length = 200) => normalizeStoredData({ ...defaultData(), pins: Array.from({ length: count }, (_, index) => ({
  id: `pin-${index}`, spaceId: 'personal', title: `Page ${index}`, url: `https://example.test/${index}/${'x'.repeat(length)}`
})) });
async function enable(browser, source = 'local') {
  const { syncAssessment: review } = await browser.run('ASSESS_SYNC');
  return browser.run('ENABLE_SYNC', { token: review.token, source });
}
async function publish(browser) { await browser.controller.flushSync(); return (await browser.run()).sync; }

async function snapshot(data, overrides = {}) {
  return packSync(data, { revision: crypto.randomUUID(), device: crypto.randomUUID(), parent: null,
    updatedAt: new Date().toISOString(), hash: await fingerprint(JSON.stringify(syncData(data))), ...overrides });
}

test('Sync stays off by default; reads, ordinary changes and navigation never read or write its storage', async () => {
  const b = fakeBrowser([tab(1, 'https://page.test/')]);
  const fail = async () => { throw new Error('Unexpected Sync access'); };
  b.api.storage.sync.get = b.api.storage.sync.set = fail;
  assert.equal((await b.run()).sync.enabled, false);
  await b.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  await b.run('SET_THEME', { theme: 'dark' });
  await b.controller.initialize();
  await b.controller.syncChanged();
  assert.equal((await b.run()).pins.length, 1);
});

test('eligibility assessment is read-only, enabling is explicit and unchanged configuration is not rewritten', async () => {
  const b = fakeBrowser();
  const original = structuredClone(b.local);
  const review = (await b.run('ASSESS_SYNC')).syncAssessment;
  assert.equal(review.fits, true);
  assert.deepEqual(b.local, original);
  assert.deepEqual(b.syncStore, {});
  await assert.rejects(b.run('ENABLE_SYNC', { source: 'local' }), /Review Sync again/);
  await b.run('ENABLE_SYNC', { source: 'local', token: review.token });
  assert.equal((await b.run()).sync.enabled, true);
  assert.equal((await b.run()).sync.pending, true);
  assert.deepEqual(b.syncStore, {});
  const status = await publish(b);
  assert.equal(status.pending, false);
  assert.equal(status.error, null);
  const stored = structuredClone(b.syncStore);
  await b.controller.flushSync();
  await b.run('SELECT_SPACE', { id: 'work' });
  await b.controller.tabsChanged();
  await b.controller.flushSync();
  assert.deepEqual(b.syncStore, stored);
});

test('chunking stays below per-item quota with Unicode, escaped quotes, and long URLs and excludes live/private state', async () => {
  const b = fakeBrowser();
  b.local.data = makeData(5, 6000);
  Object.assign(b.local.data, { secret: 'NEVER_SYNC', workspace: { url: 'https://live-private.test/' } });
  b.local.data.pins[0].title = '😀 "quoted" \\ title';
  b.local.data.pins[0].icon = 'book-open';
  b.local.data.pins[0].iconColor = '#123456';
  await enable(b);
  assert.equal((await publish(b)).error, null);
  const text = JSON.stringify(b.syncStore);
  assert.equal(text.includes('NEVER_SYNC'), false);
  assert.equal(text.includes('live-private.test'), false);
  assert.equal(text.includes('syncPrefs'), false);
  for (const [key, value] of Object.entries(b.syncStore)) assert.ok(storageBytes({ [key]: value }) < 8192);
  const restored = await readSync(b.syncStore);
  assert.equal(restored.data.pins.length, 5);
  assert.equal(restored.data.pins[0].title, b.local.data.pins[0].title);
  assert.ok(storageBytes(b.syncStore) <= SYNC_LIMIT);
});

test('oversized configurations remain local and estimate how many longest pins must be removed', async () => {
  const b = fakeBrowser();
  b.local.data = makeData(100, 1000);
  const before = structuredClone(b.local);
  const review = (await b.run('ASSESS_SYNC')).syncAssessment;
  assert.equal(review.fits, false);
  assert.ok(review.removePins > 0 && review.removePins < 100);
  assert.equal(review.pinsAloneEnough, true);
  assert.match(review.message, /pinned URLs/);
  await assert.rejects(b.run('ENABLE_SYNC', { token: review.token, source: 'local' }), /exceeds the 80 KB/);
  assert.deepEqual(b.local, before);
  assert.deepEqual(b.syncStore, {});
  const remaining = { ...b.local.data, pins: b.local.data.pins.slice(review.removePins) };
  assert.equal(assessSync(remaining).fits, true);
});

test('eligibility explains when pinned removals cannot make the configuration fit', () => {
  const data = makeData(1);
  data.favorites = makeData(100, 1000).pins.map(({ spaceId, folderId, order, ...page }) => page);
  const check = assessSync(data);
  assert.equal(check.fits, false);
  assert.equal(check.pinsAloneEnough, false);
  assert.match(capacityMessage(check), /favorites or folders/);
});

test('enabled Sync prevents over-limit additions and imports atomically until explicitly disabled', async () => {
  const b = fakeBrowser([tab(1, `https://large.test/${'x'.repeat(85000)}`)]);
  await enable(b);
  await publish(b);
  const before = structuredClone(b.local.data);
  const cloud = structuredClone(b.syncStore);
  await assert.rejects(b.run('SAVE_PAGE', { kind: 'pin', tabId: 1 }), /explicitly disable/);
  assert.deepEqual(b.local.data, before);
  assert.deepEqual(b.syncStore, cloud);
  const document = { format: 'arclet', version: 1, spaces: [{ name: 'Personal', items: [
    { type: 'pin', title: 'Large', url: `https://large.test/${'x'.repeat(85000)}` }
  ] }] };
  await assert.rejects(b.run('PREVIEW_IMPORT', { document }), /80 KB/);
  await assert.rejects(b.run('DISABLE_SYNC'), /Confirm/);
  await b.run('DISABLE_SYNC', { confirmed: true });
  await b.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  assert.equal((await b.run()).pins.length, 1);
  assert.equal((await b.run()).sync.enabled, false);
  assert.deepEqual(b.syncStore, cloud);
});

test('an enable review becomes stale after either local or remote configuration changes', async () => {
  const b = fakeBrowser();
  const first = (await b.run('ASSESS_SYNC')).syncAssessment;
  await b.run('SET_THEME', { theme: 'dark' });
  await assert.rejects(b.run('ENABLE_SYNC', { token: first.token, source: 'local' }), /changed/);
  const second = (await b.run('ASSESS_SYNC')).syncAssessment;
  Object.assign(b.syncStore, await snapshot(makeData()));
  await assert.rejects(b.run('ENABLE_SYNC', { token: second.token, source: 'local' }), /changed/);
});

test('second device can explicitly use Chrome; subsequent remote changes arrive with a local recovery copy', async () => {
  const cloud = {};
  const first = fakeBrowser([], { syncStore: cloud });
  first.local.data = makeData(2);
  await enable(first); await publish(first);
  const second = fakeBrowser([tab(9, 'https://local-browser-tab.test/')], { syncStore: cloud });
  second.local.data = makeData(1);
  await enable(second, 'remote');
  assert.equal((await second.run()).pins.length, 2);
  assert.equal(second.local.syncBackup.data.pins.length, 1);
  await first.run('SET_THEME', { theme: 'dark' });
  await publish(first);
  await second.controller.syncChanged();
  const state = await second.run();
  assert.equal(state.theme, 'dark');
  assert.equal(state.tabs[0].url, 'https://local-browser-tab.test/');
  assert.equal(state.sync.pending, false);
  assert.equal(state.sync.conflict, false);
  assert.equal((await second.run('EXPORT_SYNC_BACKUP')).exportDocument.settings.theme, 'system');
});

test('competing changes preserve local work and require an explicit reviewed choice', async () => {
  const cloud = {};
  const a = fakeBrowser([], { syncStore: cloud });
  await enable(a); await publish(a);
  const b = fakeBrowser([], { syncStore: cloud });
  await enable(b, 'remote');
  await a.run('SET_THEME', { theme: 'dark' });
  await b.run('SET_FONT_SCALE', { scale: 150 });
  await publish(a);
  await b.controller.syncChanged();
  let state = await b.run();
  assert.equal(state.fontScale, 150);
  assert.equal(state.theme, 'system');
  assert.equal(state.sync.conflict, true);
  const stored = structuredClone(cloud);
  await b.controller.flushSync();
  assert.deepEqual(cloud, stored);
  await enable(b, 'local'); await publish(b);
  assert.equal((await b.run()).sync.conflict, false);
  assert.equal(b.local.syncBackup.data.theme, 'dark');
  await a.controller.syncChanged();
  assert.equal((await a.run()).fontScale, 150);
});

test('partial or corrupt snapshots never replace a local configuration', async () => {
  const b = fakeBrowser();
  await enable(b); await publish(b);
  const before = structuredClone(b.local.data);
  const entries = await snapshot(makeData(5, 2500), { parent: b.local.syncPrefs.revision });
  Object.assign(b.syncStore, entries);
  const key = `${SYNC_PREFIX}part.1`;
  const part = b.syncStore[key];
  delete b.syncStore[key];
  await b.controller.syncChanged();
  assert.deepEqual(b.local.data, before);
  assert.match((await b.run()).sync.error, /receiving/);
  b.syncStore[key] = part;
  await b.controller.syncChanged();
  assert.equal((await b.run()).pins.length, 5);
});

test('invalid remote records and over-limit remote snapshots are refused', async () => {
  const b = fakeBrowser();
  await enable(b); await publish(b);
  const before = structuredClone(b.local.data);
  const data = makeData(); data.pins[0].url = 'javascript:alert(1)';
  Object.assign(b.syncStore, await snapshot(data, { parent: b.local.syncPrefs.revision }));
  await b.controller.syncChanged();
  assert.deepEqual(b.local.data, before);
  assert.match((await b.run()).sync.error, /invalid configuration/);
  Object.assign(b.syncStore, await snapshot(makeData(100, 1000), { parent: b.local.syncPrefs.revision }));
  await b.controller.syncChanged();
  assert.deepEqual(b.local.data, before);
  assert.match((await b.run()).sync.error, /exceeds/);
});

test('write failure retains enabled preference and local changes; retry succeeds after worker suspension', async () => {
  const b = fakeBrowser();
  await enable(b); await publish(b);
  await b.run('SET_FONT_SCALE', { scale: 125 });
  const set = b.api.storage.sync.set;
  b.api.storage.sync.set = async () => { throw new Error('Sync quota temporarily exceeded'); };
  const failed = await publish(b);
  assert.equal(failed.enabled, true);
  assert.equal(failed.pending, true);
  assert.match(failed.error, /locally|this device/);
  assert.equal(b.local.data.fontScale, 125);
  b.suspend();
  b.api.storage.sync.set = set;
  await b.run('RETRY_SYNC');
  assert.equal((await publish(b)).pending, false);
  assert.equal((await readSync(b.syncStore)).data.fontScale, 125);
});

test('shrinking snapshots clears obsolete pieces in the replacement batch; missing cloud data requires review', async () => {
  const b = fakeBrowser(); b.local.data = makeData(10, 2000);
  await enable(b); await publish(b);
  assert.ok(Object.keys(b.syncStore).length > 2);
  for (let i = 0; i < 10; i++) await b.run('REMOVE_PAGE', { kind: 'pin', id: `pin-${i}` });
  await publish(b);
  assert.equal(Object.keys(b.syncStore).length, 21);
  assert.equal(Object.entries(b.syncStore).filter(([key, value]) => key.includes('part.') && value.length).length, 1);
  for (const key of Object.keys(b.syncStore)) delete b.syncStore[key];
  await b.controller.syncChanged();
  assert.equal((await b.run()).sync.conflict, true);
  await b.controller.flushSync();
  assert.deepEqual(b.syncStore, {});
});

test('export/import never opts another installation into Sync', async () => {
  const b = fakeBrowser(); await enable(b); await publish(b);
  const document = (await b.run('EXPORT_DATA')).exportDocument;
  assert.equal(JSON.stringify(document).includes('syncPrefs'), false);
  const other = fakeBrowser();
  const review = (await other.run('PREVIEW_IMPORT', { document })).importPreview;
  await other.run('IMPORT_DATA', { document, token: review.token });
  assert.equal((await other.run()).sync.enabled, false);
  assert.deepEqual(other.syncStore, {});
});

test('usage threshold is 80% of the working limit and custom appearance remains in the snapshot', async () => {
  const b = fakeBrowser();
  let data = makeData(1, 200);
  for (let count = 100; count < 400; count++) {
    data = makeData(count, 250);
    if (assessSync(data).ratio >= .8) break;
  }
  b.local.data = data;
  Object.assign(b.local.data, { backgroundColor: '#123456', fontScale: 125 });
  b.local.data.spaces[0].backgroundColor = '#abcdef';
  await enable(b); const state = await b.run();
  assert.ok(state.sync.ratio >= .8 && state.sync.ratio < 1);
  assert.equal(state.sync.limit, 81920);
  assert.equal((await publish(b)).error, null);
  const remote = await readSync(b.syncStore);
  assert.equal(remote.data.backgroundColor, '#123456');
  assert.equal(remote.data.spaces[0].backgroundColor, '#abcdef');
});

test('enabling fails safely if Chrome storage is unavailable or the preference cannot be saved', async () => {
  const b = fakeBrowser(); delete b.api.storage.sync;
  assert.equal((await b.run()).sync.available, false);
  await assert.rejects(b.run('ASSESS_SYNC'), /unavailable/);
  const other = fakeBrowser();
  const review = (await other.run('ASSESS_SYNC')).syncAssessment;
  other.api.storage.local.set = async () => { throw new Error('Cannot save'); };
  await assert.rejects(other.run('ENABLE_SYNC', { source: 'local', token: review.token }), /Cannot save/);
  assert.equal(other.local.syncPrefs, undefined);
  assert.deepEqual(other.syncStore, {});
});

test('disabling one device does not change the Chrome copy or opt other devices out', async () => {
  const cloud = {};
  const a = fakeBrowser([], { syncStore: cloud }); await enable(a); await publish(a);
  const b = fakeBrowser([], { syncStore: cloud }); await enable(b, 'remote');
  await a.run('DISABLE_SYNC', { confirmed: true });
  await b.run('SET_THEME', { theme: 'dark' }); await publish(b);
  await a.controller.syncChanged();
  assert.equal((await a.run()).theme, 'system');
  assert.equal((await a.run()).sync.enabled, false);
  assert.equal((await b.run()).sync.enabled, true);
  assert.equal((await readSync(cloud)).data.theme, 'dark');
});

test('an incomplete Chrome copy can be explicitly repaired from a reviewed local copy', async () => {
  const b = fakeBrowser();
  await enable(b); await publish(b);
  b.syncStore[`${SYNC_PREFIX}part.0`] = 'incomplete';
  await b.controller.syncChanged();
  assert.match((await b.run()).sync.error, /receiving/);
  const review = (await b.run('ASSESS_SYNC')).syncAssessment;
  assert.equal(review.incomplete, true);
  await b.run('ENABLE_SYNC', { token: review.token, source: 'local' });
  assert.equal((await publish(b)).error, null);
  assert.equal((await readSync(b.syncStore)).incomplete, undefined);
});

test('corrupt opt-in preferences cannot enable Sync implicitly', async () => {
  const b = fakeBrowser(); b.local.syncPrefs = { enabled: 'true' };
  b.api.storage.sync.get = async () => { throw new Error('Must not access Sync'); };
  await b.controller.initialize();
  assert.equal((await b.run()).sync.enabled, false);
});

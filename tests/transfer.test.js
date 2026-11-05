import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultData } from '../src/model.js';
import { exportData, normalizeImport, planImport, MAX_TRANSFER_BYTES } from '../src/transfer.js';
import { pinnedEntries } from '../src/pinned-order.js';
import { fakeBrowser, tab } from './fake-browser.js';

const example = JSON.parse(await readFile(new URL('../docs/import-example.json', import.meta.url), 'utf8'));
const file = fields => ({ format: 'arclet', version: 1, ...fields });
const pin = (url, fields = {}) => ({ type: 'pin', url, ...fields });
const folder = (name, items = [], fields = {}) => ({ type: 'folder', name, items, ...fields });

test('documented example validates and uses stable public defaults', () => {
  const result = normalizeImport(example);
  assert.equal(result.spaces[0].name, 'Reading');
  assert.equal(result.spaces[0].items[1].items[0].type, 'pin');
  assert.deepEqual(normalizeImport(file({ spaces: [{ name: ' Empty ' }] })).spaces[0], {
    name: 'Empty', color: 'slate', backgroundColor: null, icon: 'sun', iconColor: null, items: []
  });
  assert.equal(normalizeImport(file({ favorites: [{ url: 'HTTPS://EXAMPLE.COM' }] })).favorites[0].url, 'https://example.com/');
});

test('export/import round trip preserves mixed root order, folder children, icons, colors and settings without internal state', () => {
  const source = file({
    favorites: [{ url: 'https://favorite.test/', icon: 'heart', iconColor: '#AABBCC', title: 'Favorite' }],
    spaces: [{ name: 'Personal', color: 'sage', backgroundColor: '#CCDDEE', icon: 'book-open', iconColor: '#abcdef', items: [
      folder('Books', [pin('https://b.test/'), pin('https://a.test/', { icon: 'code', iconColor: '#ff0000' })], { collapsed: true, icon: 'library', iconColor: '#112233' }),
      pin('https://root.test/'), folder('Empty'), pin('https://last.test/')
    ] }],
    settings: { theme: 'dark', backgroundColor: '#123456', showSearchBar: false, pageControlsPosition: 'right', showFavoriteLabels: false, favoritesPerRow: 8, fontScale: 150 }
  });
  const empty = { ...defaultData(), spaces: [] };
  const data = planImport(empty, source, true).data;
  const before = structuredClone(data);
  const exported = exportData(data, new Date('2026-11-04T12:00:00Z'));
  assert.equal(exported.exportedAt, '2026-11-04T12:00:00.000Z');
  assert.deepEqual(data, before);
  assert.deepEqual(exported.spaces, normalizeImport(source).spaces);
  assert.deepEqual(exported.favorites, normalizeImport(source).favorites);
  assert.deepEqual(normalizeImport(exportData(planImport(empty, exported, true).data)), normalizeImport(exported));
  assert.doesNotMatch(JSON.stringify(exported), /"(?:id|spaceId|folderId|order|windowId|tabSpaces|workspace)":/);
});

test('merges retain existing records and order, append mixed items, and repeated import is idempotent', () => {
  const first = file({ spaces: [{ name: 'Personal', color: 'rose', items: [pin('https://a.test/', { title: 'Keep' }), folder('Books', [pin('https://b.test/')], { collapsed: true })] }], favorites: [{ url: 'https://fav.test/', title: 'Keep favorite' }] });
  const existing = planImport(defaultData(), first).data;
  const snapshot = structuredClone(existing);
  const second = file({ spaces: [{ name: 'Personal', color: 'ocean', items: [folder('Books', [pin('https://a.test/', { title: 'Ignore' }), pin('https://c.test/')]), pin('https://d.test/'), folder('New', [pin('https://e.test/')])] }], favorites: [{ url: 'https://fav.test/', title: 'Ignore' }, { url: 'https://new.test/' }] });
  const { data, summary } = planImport(existing, second);
  assert.deepEqual(existing, snapshot);
  assert.deepEqual(summary, { newSpaces: 0, mergedSpaces: 1, folders: 1, pins: 3, favorites: 1, skippedPages: 2, spaceNames: ['Personal'], hasSettings: false });
  assert.equal(data.spaces[0].color, 'slate');
  assert.equal(data.pins[0].title, 'Keep');
  assert.equal(data.pins[0].folderId, undefined);
  assert.equal(data.folders[0].collapsed, true);
  assert.deepEqual(pinnedEntries(data, 'personal').map(({ kind, item }) => kind === 'folder' ? item.name : item.url), ['https://a.test/', 'Books', 'https://d.test/', 'New']);
  const repeated = planImport(data, second);
  assert.deepEqual(repeated.data, data);
  assert.equal(repeated.summary.skippedPages, 6);
});

test('settings are opt-in and partial settings preserve all omitted preferences', () => {
  const source = file({ favorites: [], settings: { theme: 'dark', fontScale: 125 } });
  const data = defaultData();
  assert.equal(planImport(data, source).data.theme, 'system');
  const applied = planImport(data, source, true).data;
  assert.equal(applied.theme, 'dark');
  assert.equal(applied.fontScale, 125);
  assert.equal(applied.favoritesPerRow, 4);
  assert.throws(() => planImport(data, source, 'true'), /whether/);
});

test('invalid formats, fields, nested folders and unsafe pages are rejected before mutation', () => {
  const data = defaultData();
  const before = structuredClone(data);
  const bad = [null, [], {}, { format: 'other', version: 1, favorites: [] }, file({ favorites: [], version: 2 }),
    file({ favorites: [], tabs: [] }), JSON.parse('{"format":"arclet","version":1,"favorites":[],"__proto__":{}}'),
    file({ spaces: [{ name: 'X', items: [folder('F', [folder('nested')])] }] }),
    ...['javascript:alert(1)', 'file:///tmp/x', 'data:text/plain,hi', 'chrome://settings/', 'not a URL'].map(url => file({ favorites: [{ url }] })),
    file({ spaces: [{ name: 'X', icon: 'unknown-icon' }] }), file({ favorites: [{ url: 'https://a.test', iconColor: 'red' }] }),
    file({ spaces: [{ name: 'X', color: '__proto__' }] }), file({ settings: { theme: 'purple' }, favorites: [] }),
    file({ favorites: [], settings: { fontScale: 101 } }), file({ favorites: [], settings: { favoritesPerRow: 0 } }),
    file({ favorites: [], settings: { showSearchBar: 'true' } }), file({ favorites: [], settings: { backgroundColor: '#123' } }),
    file({ favorites: [], exportedAt: 'November 4, 2026' })];
  for (const document of bad) assert.throws(() => planImport(data, document), undefined, JSON.stringify(document));
  assert.deepEqual(data, before);
});

test('canonical URL and group-name duplicates are rejected within the file', () => {
  for (const document of [
    file({ favorites: [{ url: 'https://EXAMPLE.COM' }, { url: 'https://example.com/' }] }),
    file({ spaces: [{ name: 'X' }, { name: ' X ' }] }),
    file({ spaces: [{ name: 'X', items: [folder('F'), folder('F')] }] }),
    file({ spaces: [{ name: 'X', items: [pin('https://a.test'), folder('F', [pin('https://a.test/')])] }] })
  ]) assert.throws(() => normalizeImport(document), /duplicate/);
  assert.doesNotThrow(() => normalizeImport(file({ spaces: [{ name: 'X', items: [pin('https://a.test/')] }, { name: 'Y', items: [pin('https://a.test/')] }], favorites: [{ url: 'https://a.test/' }] })));
});

test('limits reject oversized data and destination overflow before making a merge', () => {
  assert.throws(() => normalizeImport(file({ favorites: [], padding: 'x'.repeat(MAX_TRANSFER_BYTES) })), /5 MiB/);
  assert.throws(() => normalizeImport(file({ favorites: Array.from({ length: 10001 }, (_, i) => ({ url: `https://example.com/${i}` })) })), /10,000/);
  assert.throws(() => normalizeImport(file({ spaces: Array.from({ length: 13 }, (_, i) => ({ name: String(i) })) })), /12 spaces/);
  assert.throws(() => planImport(defaultData(), file({ spaces: Array.from({ length: 11 }, (_, i) => ({ name: String(i) })) })), /12-space/);
  assert.throws(() => normalizeImport(file({ spaces: [{ name: 'x'.repeat(33) }] })), /32 characters/);
});

test('ambiguous existing names reject import and duplicate-name exports stay portable without source changes', () => {
  const data = defaultData();
  data.spaces.push({ ...data.spaces[0], id: 'duplicate' });
  data.folders.push({ id: 'f1', spaceId: 'personal', name: 'Same', icon: 'folder' }, { id: 'f2', spaceId: 'personal', name: 'Same', icon: 'folder' });
  assert.throws(() => planImport(data, file({ spaces: [{ name: 'Personal' }] })), /More than one existing space/);
  const before = structuredClone(data);
  const exported = exportData(data);
  assert.deepEqual(exported.spaces.map(space => space.name), ['Personal', 'Work', 'Personal (2)']);
  assert.deepEqual(exported.spaces[0].items.map(item => item.name), ['Same', 'Same (2)']);
  assert.deepEqual(data, before);
  data.spaces.pop();
  assert.throws(() => planImport(data, file({ spaces: [{ name: 'Personal', items: [folder('Same')] }] })), /More than one folder/);
});

test('preview and export do not write storage; confirmed imports persist without changing live tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 0, 2)]);
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  const before = structuredClone(browser.local);
  const live = structuredClone(browser.live);
  const tabs = await browser.api.tabs.query();
  const preview = (await browser.run('PREVIEW_IMPORT', { document: example })).importPreview;
  await browser.run('EXPORT_DATA');
  assert.deepEqual(browser.local, before);
  assert.deepEqual(browser.live, live);
  const state = await browser.run('IMPORT_DATA', { document: example, token: preview.token });
  assert.equal(state.spaces.length, 3);
  assert.equal(state.theme, 'system');
  assert.deepEqual(await browser.api.tabs.query(), tabs);
  assert.deepEqual(browser.live.tabSpaces, live.tabSpaces);
  browser.suspend();
  const persisted = await browser.run();
  assert.equal(persisted.folders[0].name, 'Reference');
  assert.equal(persisted.pins.length, 2);
  browser.restart([tab(11, 'https://a.test/'), tab(22, 'https://b.test/', 0, 2)]);
  assert.equal((await browser.run()).favorites.length, 1);
});

test('stale preview is rejected after another panel changes saved data', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  const preview = (await browser.run('PREVIEW_IMPORT', { document: example })).importPreview;
  await browser.run('SET_THEME', { theme: 'dark' }, 2);
  const before = structuredClone(browser.local);
  await assert.rejects(browser.run('IMPORT_DATA', { document: example, token: preview.token }), /changed since the preview/);
  assert.deepEqual(browser.local, before);
  await assert.rejects(browser.run('IMPORT_DATA', { document: example }), /changed since the preview/);
});

test('navigation alone keeps a preview valid and invalid import keeps all saved state intact', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  const preview = (await browser.run('PREVIEW_IMPORT', { document: example })).importPreview;
  browser.change(1, { url: 'https://new.test/' });
  await browser.run('GET_STATE');
  const before = structuredClone(browser.local.data);
  await assert.rejects(browser.run('IMPORT_DATA', { document: file({ favorites: [{ url: 'javascript:1' }] }), token: preview.token }), /http and https/);
  assert.deepEqual(browser.local.data, before);
  const state = await browser.run('IMPORT_DATA', { document: example, token: preview.token, applySettings: true });
  assert.equal(state.pins.length, 2);
  assert.equal(state.tabs[0].url, 'https://new.test/');
});

test('failed local storage write leaves existing saved data intact and import can be retried', async () => {
  const browser = fakeBrowser();
  const preview = (await browser.run('PREVIEW_IMPORT', { document: example })).importPreview;
  const before = structuredClone(browser.local);
  const save = browser.api.storage.local.set;
  browser.api.storage.local.set = async () => { throw new Error('Storage quota exceeded'); };
  await assert.rejects(browser.run('IMPORT_DATA', { document: example, token: preview.token }), /quota/);
  assert.deepEqual(browser.local, before);
  browser.api.storage.local.set = save;
  assert.equal((await browser.run('IMPORT_DATA', { document: example, token: preview.token })).pins.length, 2);
});

test('page control placement exports and imports as an optional appearance setting', () => {
  const data = { ...defaultData(), pageControlsPosition: 'right' };
  const document = exportData(data);
  assert.equal(document.settings.pageControlsPosition, 'right');
  assert.equal(planImport(defaultData(), document).data.pageControlsPosition, 'left');
  assert.equal(planImport(defaultData(), document, true).data.pageControlsPosition, 'right');
  delete document.settings.pageControlsPosition;
  assert.equal(planImport(data, document, true).data.pageControlsPosition, 'right');
  document.settings.pageControlsPosition = 'bottom';
  assert.throws(() => normalizeImport(document), /left or right/);
});

test('space deletion merges duplicate pins and leaves the discarded instance open', async () => {
  const browser = fakeBrowser([tab(1, 'https://same.test/'), tab(2, 'https://same.test/', 1)]);
  await browser.run('SAVE_PAGE', { tabId: 1, kind: 'pin', spaceId: 'personal' });
  await browser.run('SAVE_PAGE', { tabId: 2, kind: 'pin', spaceId: 'work' });
  const state = await browser.run('DELETE_SPACE', { id: 'work' });
  assert.equal(state.pins.length, 1);
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs.find(tab => tab.id === 2).savedPageId, null);
  assert.equal((await browser.run('EXPORT_DATA')).exportDocument.spaces[0].items.length, 1);
});

test('long addresses and whitespace-only titles save and round trip', async () => {
  const url = `https://long.test/?q=${'a'.repeat(9000)}`;
  const browser = fakeBrowser([tab(1, url, 0, 1, { title: '\u00a0' })]);
  assert.equal((await browser.run('SAVE_PAGE', { tabId: 1, kind: 'pin' })).pins[0].title, 'long.test');
  const document = (await browser.run('EXPORT_DATA')).exportDocument;
  assert.equal(normalizeImport(document).spaces[0].items[0].url, url);
});

test('legacy duplicates and blank titles export without altering the source', () => {
  const data = defaultData();
  data.pins = [1, 2].map(id => ({ id: String(id), spaceId: 'personal', url: 'https://old.test/', title: '\u00a0' }));
  const before = structuredClone(data);
  const exported = exportData(data);
  assert.equal(exported.spaces[0].items.length, 1);
  assert.equal(exported.spaces[0].items[0].title, 'old.test');
  assert.deepEqual(data, before);
});

test('saving a layout beyond the backup size limit leaves durable data intact', async () => {
  const browser = fakeBrowser([tab(1, `https://huge.test/?q=${'a'.repeat(MAX_TRANSFER_BYTES)}`)]);
  const before = structuredClone(browser.local.data);
  await assert.rejects(browser.run('SAVE_PAGE', { tabId: 1, kind: 'pin' }), /5 MiB/);
  assert.deepEqual(browser.local.data, before);
});

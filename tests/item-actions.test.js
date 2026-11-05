import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { HOME_PAGE_ID, homePage, navigationMode } from '../src/home-page.js';
import { defaultData } from '../src/model.js';
import { createDemoApi } from '../src/demo.js';
import { createController } from '../src/controller.js';
import { pageSession } from '../src/saved-tabs.js';
import { pinnedEntries } from '../src/pinned-order.js';
import { exportData, planImport, normalizeImport } from '../src/transfer.js';
import { fingerprint, packSync, readSync, SYNC_HEAD, SYNC_PREFIX, syncData } from '../src/sync-format.js';

async function fixture(kind = 'pin') {
  const b = fakeBrowser([tab(1, 'https://root.test/', 0, 1, { title: 'Saved name' }), tab(2, 'https://ordinary.test/', 1)]);
  const state = await b.run('SAVE_PAGE', { kind, tabId: 1 });
  return { b, page: (kind === 'pin' ? state.pins : state.favorites)[0] };
}

for (const kind of ['pin', 'favorite']) test(`${kind}: duplicate uses current page and gives it an independent instance`, async () => {
  const { b, page } = await fixture(kind);
  b.change(1, { url: 'https://child.test/article', title: 'Current article' });
  const state = await b.run('DUPLICATE_PAGE', { kind, id: page.id });
  const created = state.tabs.find(tab => tab.id !== 1 && tab.id !== 2);
  assert.equal(created.url, 'https://child.test/article');
  assert.equal(created.active, true);
  assert.equal(state.tabs.find(tab => tab.id === 1).savedPageId, page.id);
  assert.equal(state[kind === 'pin' ? 'pins' : 'favorites'][0].url, 'https://root.test/');
  if (kind === 'pin') {
    assert.equal(state.pins.length, 2);
    const duplicate = state.pins.find(pin => pin.id !== page.id);
    assert.equal(duplicate.url, created.url);
    assert.equal(created.savedPageId, duplicate.id);
    assert.equal(pageSession(duplicate, state.tabs).status, 'home');
    await b.run('CLOSE_SAVED_PAGE', { id: page.id });
    assert.equal(pageSession(duplicate, (await b.run()).tabs).tab.id, created.id);
  } else {
    assert.equal(state.favorites.length, 1);
    assert.equal(created.savedPageId, null);
  }
});

for (const kind of ['pin', 'favorite']) test(`closed ${kind}: duplicate opens its saved URL without opening the original`, async () => {
  const { b, page } = await fixture(kind);
  await b.run('CLOSE_SAVED_PAGE', { id: page.id });
  const state = await b.run('DUPLICATE_PAGE', { kind, id: page.id });
  const created = state.tabs.find(tab => tab.id !== 2);
  assert.equal(created.url, page.url);
  assert.equal(pageSession(page, state.tabs).status, 'closed');
  assert.equal(kind === 'pin' ? !!created.savedPageId : created.savedPageId, kind === 'pin' ? true : null);
});

test('root duplicates survive folder operations, restart, backup round trip, and repeated import', async () => {
  const { b, page } = await fixture();
  let state = await b.run('SAVE_FOLDER', { name: 'Reading', icon: 'folder', pageId: page.id });
  const folder = state.folders[0];
  await b.run('SET_PAGE_ICON', { kind: 'pin', id: page.id, icon: 'book-open', iconColor: '#123456' });
  state = await b.run('DUPLICATE_PAGE', { kind: 'pin', id: page.id });
  const copy = state.pins.find(pin => pin.id !== page.id);
  assert.equal(copy.folderId, folder.id);
  assert.equal(copy.iconColor, '#123456');
  assert.deepEqual(pinnedEntries(state, 'personal', folder.id).map(entry => entry.item.id), [page.id, copy.id]);
  b.suspend();
  assert.equal((await b.run()).pins.length, 2);
  const native = (await b.api.tabs.query({})).map(tab => ({ ...tab, id: tab.id + 100 }));
  b.restart(native);
  assert.equal((await b.run()).pins.length, 2);
  const document = (await b.run('EXPORT_DATA')).exportDocument;
  assert.equal(document.spaces[0].items[0].items.length, 2);
  const imported = planImport(defaultData(), document).data;
  assert.equal(imported.pins.length, 2);
  assert.equal(planImport(imported, document).summary.pins, 0);
  assert.equal((await readSync(await readySnapshot(imported))).data.pins.length, 2);
});

async function readySnapshot(data) {
  return packSync(data, { revision: crypto.randomUUID(), device: crypto.randomUUID(), parent: null,
    updatedAt: new Date().toISOString(), hash: await fingerprint(JSON.stringify(syncData(data))) });
}

test('normal duplicates stay regular even at saved addresses and native pinned status is removed', async () => {
  const { b, page } = await fixture();
  b.change(2, { url: page.url, pinned: true });
  const state = await b.run('DUPLICATE_TAB', { id: 2 });
  const copy = state.tabs.find(tab => tab.id !== 1 && tab.id !== 2);
  assert.equal(copy.savedPageId, null);
  assert.equal(copy.pinned, false);
  assert.equal(copy.spaceId, 'personal');
  await assert.rejects(b.run('DUPLICATE_TAB', { id: 1 }), /own menu/);
  b.change(2, { windowId: 2 });
  await assert.rejects(b.run('DUPLICATE_TAB', { id: 2 }), /another window/);
});

test('favorite duplication follows the selected space rather than its instance’s original space', async () => {
  const { b, page } = await fixture('favorite');
  await b.run('SELECT_SPACE', { id: 'work' });
  const state = await b.run('DUPLICATE_PAGE', { kind: 'favorite', id: page.id });
  const copy = state.tabs.find(tab => tab.id !== 1 && tab.id !== 2);
  assert.equal(copy.spaceId, 'work');
  assert.equal(state.spaceId, 'work');
});

for (const kind of ['pin', 'favorite']) test(`${kind}: rename changes only its saved name and persists`, async () => {
  const { b, page } = await fixture(kind);
  b.change(1, { url: 'https://away.test/', title: 'Live title' });
  const state = await b.run('RENAME_PAGE', { kind, id: page.id, title: '  My research  ' });
  const saved = state[kind === 'pin' ? 'pins' : 'favorites'][0];
  assert.equal(saved.title, 'My research');
  assert.equal(saved.url, page.url);
  assert.equal(state.tabs[0].title, 'Live title');
  assert.equal(state.tabs[0].savedPageId, page.id);
  b.suspend();
  assert.equal((await b.run())[kind === 'pin' ? 'pins' : 'favorites'][0].title, 'My research');
  for (const title of ['', '  ', 'x'.repeat(201), null]) await assert.rejects(b.run('RENAME_PAGE', { kind, id: page.id, title }), /1 and 200/);
  await assert.rejects(b.run('RENAME_PAGE', { kind: kind === 'pin' ? 'favorite' : 'pin', id: page.id, title: 'Wrong' }), /no longer exists/);
});

test('pinned duplication checks Sync capacity before creating a browser tab', async () => {
  const { b, page } = await fixture();
  const { syncAssessment } = await b.run('ASSESS_SYNC');
  await b.run('ENABLE_SYNC', { source: 'local', token: syncAssessment.token });
  b.change(1, { url: `https://large.test/${'x'.repeat(85000)}` });
  const before = await b.api.tabs.query({});
  await assert.rejects(b.run('DUPLICATE_PAGE', { kind: 'pin', id: page.id }), /80 KB/);
  assert.deepEqual(await b.api.tabs.query({}), before);
  assert.equal((await b.run()).pins.length, 1);
});

test('native duplicate failure leaves the saved item and configuration intact', async () => {
  const { b, page } = await fixture();
  b.api.tabs.duplicate = async () => { throw new Error('Cannot duplicate'); };
  const before = structuredClone(b.local);
  await assert.rejects(b.run('DUPLICATE_PAGE', { kind: 'pin', id: page.id }), /Cannot duplicate/);
  assert.deepEqual(b.local, before);
});

test('Home is an independent favorite; changing or clearing its URL releases its live tab', async () => {
  const b = fakeBrowser();
  await b.run('SET_HOME_URL', { url: 'https://home.test' });
  let state = await b.run('OPEN_PAGE', { id: HOME_PAGE_ID });
  const instance = state.tabs[0];
  assert.equal(instance.savedPageId, HOME_PAGE_ID);
  b.change(instance.id, { url: 'https://home.test/child' });
  state = await b.run('OPEN_PAGE', { id: HOME_PAGE_ID });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].url, 'https://home.test/child');
  state = await b.run('DUPLICATE_PAGE', { kind: 'home', id: HOME_PAGE_ID });
  assert.equal(state.tabs.find(tab => tab.id !== instance.id).url, 'https://home.test/child');
  assert.equal(state.tabs.find(tab => tab.id !== instance.id).savedPageId, null);
  await b.run('RENAME_PAGE', { kind: 'home', id: HOME_PAGE_ID, title: 'Start' });
  assert.equal(homePage(await b.run()).title, 'Start');
  await b.run('CLOSE_SAVED_PAGE', { id: HOME_PAGE_ID });
  state = await b.run('OPEN_PAGE', { id: HOME_PAGE_ID });
  assert.equal(pageSession(homePage(state), state.tabs).tab.url, 'https://home.test/');
  await b.run('SET_HOME_URL', { url: 'https://new-home.test/' });
  assert.equal((await b.run()).tabs.some(tab => tab.savedPageId === HOME_PAGE_ID), false);
  state = await b.run('OPEN_PAGE', { id: HOME_PAGE_ID });
  assert.equal(pageSession(homePage(state), state.tabs).tab.url, 'https://new-home.test/');
  await b.run('SET_HOME_URL', { url: null });
  assert.equal(homePage(await b.run()), null);
  assert.equal((await b.run()).tabs.some(tab => tab.savedPageId === HOME_PAGE_ID), false);
  for (const url of ['javascript:alert(1)', 'file:///secret', 'chrome://settings', 42]) await assert.rejects(b.run('SET_HOME_URL', { url }));
});

test('navigation modes migrate old preferences, persist, and round trip with the Home destination', async () => {
  const b = fakeBrowser();
  assert.equal(navigationMode(await b.run()), 'full');
  b.local.data.showSearchBar = false;
  assert.equal(navigationMode(await b.run()), 'hidden');
  let state = await b.run('SET_TOOLBAR_MODE', { mode: 'controls' });
  assert.equal(navigationMode(state), 'controls');
  await b.run('SET_HOME_URL', { url: 'https://home.test/' });
  b.suspend();
  assert.equal(navigationMode(await b.run()), 'controls');
  const document = (await b.run('EXPORT_DATA')).exportDocument;
  const imported = planImport(defaultData(), document, true).data;
  assert.equal(imported.homeUrl, 'https://home.test/');
  assert.equal(imported.showUrlBar, false);
  const remote = await readSync(await readySnapshot(imported));
  assert.equal(remote.head.version, 2);
  assert.equal(remote.data.homeUrl, imported.homeUrl);
  assert.equal(remote.data.showUrlBar, false);
  await b.run('SET_TOOLBAR_MODE', { mode: 'full' });
  assert.equal(navigationMode(await b.run()), 'full');
  await assert.rejects(b.run('SET_TOOLBAR_MODE', { mode: 'bad' }), /navigation bar/);
  document.settings.showUrlBar = 'no';
  assert.throws(() => normalizeImport(document), /true or false/);
});

test('old Sync snapshots remain readable without expanding the default configuration', async () => {
  const data = defaultData();
  const entries = await readySnapshot(data);
  entries[SYNC_HEAD].version = 1;
  const remote = await readSync(entries);
  assert.equal(remote.data.showUrlBar, true);
  assert.equal(remote.data.homeUrl, null);
  assert.equal(JSON.stringify(entries).includes('homeUrl'), false);
});

test('preview duplicates retain independent native Back/Forward history', async () => {
  const controller = createController(createDemoApi());
  const run = (type, payload = {}) => controller.dispatch({ type, payload, windowId: 1 });
  const state = await run('DUPLICATE_PAGE', { kind: 'pin', id: 'design' });
  const copy = state.pins.find(pin => pin.id !== 'design' && pin.id !== 'notes');
  const away = await run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  assert.equal(pageSession(copy, away.tabs).status, 'away');
  assert.equal(pageSession(state.pins[0], away.tabs).tab.url, 'https://www.are.na/');
});

test('version 1 backups migrate while version 2 preserves duplicate pins and Home settings', () => {
  assert.equal(normalizeImport({ format: 'arclet', version: 1, spaces: [] }).version, 2);
  const document = { format: 'arclet', version: 1, spaces: [{ name: 'X', items: [
    { type: 'pin', url: 'https://same.test/' }, { type: 'pin', url: 'https://same.test/' }
  ] }] };
  assert.throws(() => normalizeImport(document), /duplicate/);
  document.version = 2;
  assert.equal(normalizeImport(document).spaces[0].items.length, 2);
  assert.equal(exportData(defaultData()).version, 2);
});

for (const kind of ['email', 'calendar']) test(`${kind}: dedicated instance resumes, duplicates the current page, resets, closes, and survives restart`, async () => {
  const { controlFavorite } = await import('../src/home-page.js');
  const b = fakeBrowser();
  await b.run('SET_CONTROL_FAVORITE_URL', { kind, url: `https://${kind}.test/` });
  const page = controlFavorite(await b.run(), kind);
  let state = await b.run('OPEN_PAGE', { id: page.id });
  const first = pageSession(page, state.tabs).tab;
  b.change(first.id, { url: `https://${kind}.test/article` });
  state = await b.run('OPEN_PAGE', { id: page.id });
  assert.equal(state.tabs.length, 1);
  assert.equal(pageSession(page, state.tabs).status, 'away');
  state = await b.run('DUPLICATE_PAGE', { kind, id: page.id });
  const duplicate = state.tabs.find(tab => tab.id !== first.id);
  assert.equal(duplicate.url, `https://${kind}.test/article`);
  assert.equal(duplicate.savedPageId, null);
  state = await b.run('RESET_SAVED_PAGE', { id: page.id });
  assert.equal(pageSession(page, state.tabs).tab.id, first.id);
  assert.equal(pageSession(page, state.tabs).tab.url, page.url);
  await b.run('RENAME_PAGE', { kind, id: page.id, title: `My ${kind}` });
  b.suspend();
  assert.equal(controlFavorite(await b.run(), kind).title, `My ${kind}`);
  b.restart((await b.api.tabs.query({})).map(tab => ({ ...tab, id: tab.id + 100 })));
  state = await b.run();
  assert.equal(pageSession(page, state.tabs).status, 'home');
  await b.run('CLOSE_SAVED_PAGE', { id: page.id });
  state = await b.run('OPEN_PAGE', { id: page.id });
  assert.equal(pageSession(page, state.tabs).tab.url, page.url);
});

test('control favorites sharing an address own independent tabs per window and release only the changed destination', async () => {
  const { CONTROL_FAVORITES, controlFavorite } = await import('../src/home-page.js');
  const b = fakeBrowser();
  for (const item of CONTROL_FAVORITES) {
    await b.run('SET_CONTROL_FAVORITE_URL', { kind: item.kind, url: 'https://shared.test/' });
    for (const windowId of [1, 2]) await b.run('OPEN_PAGE', { id: item.id }, windowId);
  }
  const before = await b.api.tabs.query({});
  assert.equal(before.length, 6);
  for (const windowId of [1, 2]) {
    const state = await b.run('GET_STATE', {}, windowId);
    assert.equal(new Set(CONTROL_FAVORITES.map(item => pageSession(controlFavorite(state, item.kind), state.tabs).tab.id)).size, 3);
  }
  await b.run('SET_CONTROL_FAVORITE_URL', { kind: 'email', url: 'https://new-mail.test/' });
  for (const windowId of [1, 2]) {
    const state = await b.run('GET_STATE', {}, windowId);
    assert.equal(state.tabs.filter(tab => tab.savedPageId === 'arclet-email').length, 0);
    assert.equal(state.tabs.filter(tab => ['arclet-home', 'arclet-calendar'].includes(tab.savedPageId)).length, 2);
  }
  await b.run('OPEN_PAGE', { id: 'arclet-email' });
  const state = await b.run('SET_CONTROL_FAVORITE_URL', { kind: 'email', url: null });
  assert.equal(controlFavorite(state, 'email'), null);
  assert.equal(state.tabs.find(tab => tab.url === 'https://new-mail.test/').savedPageId, null);
  assert.equal((await b.api.tabs.query({})).length, 7);
});

test('control favorites validate destinations, reserve their IDs, and remain local when Sync capacity would be exceeded', async () => {
  const { normalizeStoredData } = await import('../src/stored-data.js');
  const b = fakeBrowser();
  for (const kind of ['email', 'calendar']) {
    for (const url of ['mailto:me@example.com', 'javascript:alert(1)', 'file:///secret', 42]) {
      await assert.rejects(b.run('SET_CONTROL_FAVORITE_URL', { kind, url }));
    }
  }
  await assert.rejects(b.run('SET_CONTROL_FAVORITE_URL', { kind: 'other', url: null }), /Choose Home/);
  const repaired = normalizeStoredData({ ...defaultData(), emailUrl: 'mailto:x@y.test', calendarTitle: ' ',
    favorites: [{ id: 'arclet-email', url: 'https://other.test/' }] });
  assert.equal(repaired.emailUrl, null);
  assert.equal(repaired.calendarTitle, 'Calendar');
  assert.notEqual(repaired.favorites[0].id, 'arclet-email');
  const { syncAssessment } = await b.run('ASSESS_SYNC');
  await b.run('ENABLE_SYNC', { source: 'local', token: syncAssessment.token });
  const before = structuredClone(b.local.data);
  await assert.rejects(b.run('SET_CONTROL_FAVORITE_URL', { kind: 'calendar', url: `https://large.test/${'x'.repeat(85000)}` }), /80 KB/);
  assert.deepEqual(b.local.data, before);
});

test('Email and Calendar destinations and names round trip through backup and Sync, with v1 defaults preserved', async () => {
  const b = fakeBrowser();
  for (const kind of ['email', 'calendar']) {
    await b.run('SET_CONTROL_FAVORITE_URL', { kind, url: `https://${kind}.test/` });
    await b.run('RENAME_PAGE', { kind, id: `arclet-${kind}`, title: `My ${kind}` });
  }
  const document = (await b.run('EXPORT_DATA')).exportDocument;
  const imported = planImport(defaultData(), document, true).data;
  const remote = await readSync(await readySnapshot(imported));
  for (const kind of ['email', 'calendar']) {
    assert.equal(imported[`${kind}Url`], `https://${kind}.test/`);
    assert.equal(remote.data[`${kind}Title`], `My ${kind}`);
    assert.equal(planImport(defaultData(), document, false).data[`${kind}Url`], null);
    const legacy = { format: 'arclet', version: 1, spaces: [], settings: { [`${kind}Url`]: `https://${kind}.test/` } };
    assert.throws(() => normalizeImport(legacy));
  }
  const defaults = await readySnapshot(defaultData());
  defaults[SYNC_HEAD].version = 1;
  const old = (await readSync(defaults)).data;
  assert.equal(old.emailUrl, null);
  assert.equal(old.calendarUrl, null);
  assert.equal(JSON.stringify(defaults).includes('emailUrl'), false);
});

for (const kind of ['pin', 'favorite']) test(`${kind}: Edit saves name and icon together without changing the root or running instance`, async () => {
  const { b, page } = await fixture(kind);
  b.change(1, { url: 'https://away.test/' });
  const before = structuredClone(b.local.data);
  await assert.rejects(b.run('EDIT_PAGE', { kind, id: page.id, title: 'Not applied', icon: 'missing-icon', iconColor: '#123456' }));
  assert.deepEqual(b.local.data, before);
  const state = await b.run('EDIT_PAGE', { kind, id: page.id, title: '  Research  ', icon: 'book-open', iconColor: '#123456' });
  const updated = state[kind === 'pin' ? 'pins' : 'favorites'][0];
  assert.equal(updated.title, 'Research');
  assert.equal(updated.icon, 'book-open');
  assert.equal(updated.iconColor, '#123456');
  assert.equal(updated.url, page.url);
  assert.equal(state.tabs[0].url, 'https://away.test/');
  assert.equal(state.tabs[0].savedPageId, page.id);
  b.suspend();
  assert.deepEqual((await b.run())[kind === 'pin' ? 'pins' : 'favorites'][0], updated);
  const reset = await b.run('EDIT_PAGE', { kind, id: page.id, title: 'Site icon', icon: null, iconColor: null });
  assert.equal(reset[kind === 'pin' ? 'pins' : 'favorites'][0].icon, null);
});

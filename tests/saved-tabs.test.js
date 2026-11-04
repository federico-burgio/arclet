import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { pageSession, sameUrl } from '../src/saved-tabs.js';
import { openTabsForSpace } from '../src/model.js';
import { createDemoApi } from '../src/demo.js';
import { createController } from '../src/controller.js';

const owner = (state, page) => state.tabs.find(tab => tab.savedPageId === page.id);
const regular = state => openTabsForSpace(state.tabs, state.pins, state.spaceId, state.favorites);
async function fixture(kind = 'pin') {
  const browser = fakeBrowser([tab(1, 'https://home.test/'), tab(2, 'https://other.test/', 1)]);
  const state = await browser.run('SAVE_PAGE', { kind, tabId: 1 });
  return { browser, page: (kind === 'pin' ? state.pins : state.favorites)[0] };
}

test('ownership survives same-domain, cross-domain, route, redirect, and loading navigation without changing the saved root', async () => {
  const { browser, page } = await fixture();
  for (const url of ['https://home.test/article', 'https://home.test/?q=1#section', 'https://elsewhere.test/']) {
    browser.change(1, { url, title: 'Current page', status: 'loading', audible: true });
    await browser.controller.tabsChanged();
    const state = await browser.run();
    assert.equal(owner(state, page).id, 1);
    assert.equal(pageSession(page, state.tabs).status, 'away');
    assert.equal(owner(state, page).audible, true);
    assert.deepEqual(regular(state).map(tab => tab.id), [2]);
    assert.equal(state.pins[0].url, 'https://home.test/');
    assert.equal(state.pins[0].title, page.title);
  }
  browser.change(1, { url: 'https://home.test/', discarded: true });
  assert.equal(pageSession(page, (await browser.run()).tabs).status, 'home');
});

test('clicking an away saved item resumes its current instance; reset navigates that instance home', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://home.test/article', active: false });
  browser.change(2, { active: true });
  const state = await browser.run('OPEN_PAGE', { id: page.id });
  assert.equal(state.tabs.length, 2);
  assert.equal(owner(state, page).url, 'https://home.test/article');
  assert.equal(owner(state, page).active, true);
  const reset = await browser.run('RESET_SAVED_PAGE', { id: page.id });
  assert.equal(owner(reset, page).id, 1);
  assert.equal(owner(reset, page).url, page.url);
  assert.equal(pageSession(page, reset.tabs).status, 'home');
});

test('native Back/Forward history and return-home keep one saved instance in the preview', async () => {
  const api = createDemoApi();
  const controller = createController(api);
  const run = (type, payload = {}) => controller.dispatch({ type, payload, windowId: 1 });
  const initial = await run('GET_STATE');
  const page = initial.pins[0];
  assert.equal(owner(initial, page).id, 1);
  let state = await run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  assert.equal(pageSession(page, state.tabs).status, 'away');
  assert.equal(regular(state).length, 3);
  state = await run('OPEN_PAGE', { id: page.id });
  assert.equal(owner(state, page).url, 'https://www.are.na/explore');
  state = await run('NAVIGATE_ACTIVE_TAB', { direction: 'forward' });
  assert.equal(pageSession(page, state.tabs).status, 'home');
  await run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  await run('RESET_SAVED_PAGE', { id: page.id });
  state = await run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  assert.equal(owner(state, page).url, 'https://www.are.na/explore');
  assert.equal(state.tabs.length, 6);
});

test('closing a pin or favorite keeps the saved item, reopening starts at home, and duplicate-root tabs remain regular', async () => {
  for (const kind of ['pin', 'favorite']) {
    const { browser, page } = await fixture(kind);
    browser.change(1, { url: 'https://home.test/away' });
    let state = await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
    assert.equal(pageSession(page, state.tabs).status, 'closed');
    assert.equal((kind === 'pin' ? state.pins : state.favorites)[0].id, page.id);
    state = await browser.run('OPEN_PAGE', { id: page.id });
    assert.equal(owner(state, page).url, page.url);
    assert.notEqual(owner(state, page).id, 1);
    await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
    await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
    assert.equal((await browser.run()).tabs.length, 1);
  }
});

test('removing a navigated saved item releases its tab and prevents ownership from reappearing after restore', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  let state = await browser.run('REMOVE_PAGE', { kind: 'pin', id: page.id });
  assert.equal(state.tabs.find(tab => tab.id === 1).savedPageId, null);
  assert.deepEqual(regular(state).map(tab => tab.id), [1, 2]);
  assert.equal(state.pins.length, 0);
  await browser.run('CLOSE_TAB', { id: 1 });
  state = await browser.run('RESTORE_TAB');
  assert.equal(state.tabs.find(tab => tab.url === 'https://away.test/').savedPageId, null);
});

test('bulk cleanup and middle-click protect owned instances after navigation but allow independent duplicate roots', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  const duplicate = await browser.api.tabs.create({ url: page.url, windowId: 1, active: false });
  await browser.controller.tabCreated(duplicate);
  assert.deepEqual(regular(await browser.run()).map(tab => tab.id), [2, duplicate.id]);
  await assert.rejects(browser.run('CLOSE_REGULAR_TAB', { id: 1 }), /Pinned and favorite/);
  await browser.run('CLOSE_OPEN_TABS', { mode: 'regular' });
  assert.deepEqual((await browser.run()).tabs.map(tab => tab.id), [1]);
  assert.equal((await browser.run()).pins[0].id, page.id);
});

test('favorites reuse an instance across spaces and activation does not unexpectedly change space', async () => {
  const { browser, page } = await fixture('favorite');
  browser.change(1, { url: 'https://away.test/' });
  await browser.run('SELECT_SPACE', { id: 'work' });
  let state = await browser.run('OPEN_PAGE', { id: page.id });
  assert.equal(state.spaceId, 'work');
  assert.equal(state.tabs.length, 2);
  assert.equal(owner(state, page).id, 1);
  await browser.controller.tabActivated({ tabId: 1, windowId: 1 });
  assert.equal((await browser.run()).spaceId, 'work');
  state = await browser.run('ACTIVATE_TAB', { id: 1 });
  assert.equal(state.spaceId, 'work');
});

test('each window has an independent instance and saved-item actions target only the requesting window', async () => {
  const { browser, page } = await fixture('favorite');
  const second = await browser.run('OPEN_PAGE', { id: page.id }, 2);
  assert.equal(second.tabs.length, 1);
  browser.change(1, { url: 'https://one.test/' });
  browser.change(second.tabs[0].id, { url: 'https://two.test/' });
  await browser.run('RESET_SAVED_PAGE', { id: page.id }, 2);
  assert.equal(owner(await browser.run(), page).url, 'https://one.test/');
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id }, 2);
  assert.equal(owner(await browser.run(), page).id, 1);
});

test('a second saved entry for an owned URL does not steal that instance', async () => {
  const { browser, page } = await fixture();
  let state = await browser.run('SAVE_PAGE', { kind: 'favorite', pageId: page.id });
  const favorite = state.favorites[0];
  assert.equal(pageSession(favorite, state.tabs).status, 'closed');
  state = await browser.run('OPEN_PAGE', { id: favorite.id });
  assert.notEqual(owner(state, favorite).id, owner(state, page).id);
  assert.equal(state.tabs.length, 3);
});

test('opening a closed saved item adopts only a unique or active eligible home tab', async () => {
  const { browser, page } = await fixture();
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  const a = await browser.api.tabs.create({ windowId: 1, url: page.url, active: false });
  await browser.controller.tabCreated(a);
  assert.equal(owner(await browser.run('OPEN_PAGE', { id: page.id }), page).id, a.id);
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  const b = await browser.api.tabs.create({ windowId: 1, url: page.url, active: false });
  const c = await browser.api.tabs.create({ windowId: 1, url: page.url, active: false });
  await browser.controller.tabCreated(b); await browser.controller.tabCreated(c);
  const state = await browser.run('OPEN_PAGE', { id: page.id });
  assert.ok(![b.id, c.id].includes(owner(state, page).id));
  assert.deepEqual(regular(state).map(tab => tab.id), [2, b.id, c.id]);
});

test('native close is reflected without unpinning; a cancelled close retains ownership', async () => {
  const { browser, page } = await fixture();
  const remove = browser.api.tabs.remove;
  browser.api.tabs.remove = async () => {};
  assert.equal(owner(await browser.run('CLOSE_SAVED_PAGE', { id: page.id }), page).id, 1);
  browser.api.tabs.remove = remove;
  browser.change(1, { url: 'https://away.test/' });
  await browser.controller.tabsChanged();
  await browser.api.tabs.remove(1);
  await browser.controller.tabRemoved(1, { windowId: 1, isWindowClosing: false });
  const state = await browser.run();
  assert.equal(pageSession(page, state.tabs).status, 'closed');
  assert.equal(state.pins.length, 1);
});

test('Arclet Restore last closed tab reattaches an identified away session, but a conflict stays regular', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  let state = await browser.run('RESTORE_TAB');
  assert.equal(owner(state, page).url, 'https://away.test/');
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  await browser.run('OPEN_PAGE', { id: page.id });
  state = await browser.run('RESTORE_TAB');
  assert.equal(owner(state, page).url, page.url);
  assert.ok(regular(state).some(tab => tab.url === 'https://away.test/'));
});

test('worker suspension, tab replacement, folder operations and appearance edits retain ownership', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  await browser.run('SAVE_FOLDER', { name: 'Reading', icon: 'folder', pageId: page.id });
  await browser.run('SET_PAGE_ICON', { kind: 'pin', id: page.id, icon: 'heart', iconColor: '#123456' });
  browser.suspend();
  let state = await browser.run();
  assert.equal(owner(state, page).id, 1);
  browser.setTabs([tab(99, 'https://away.test/'), tab(2, 'https://other.test/', 1)]);
  await browser.controller.tabReplaced(99, 1);
  state = await browser.run();
  assert.equal(owner(state, page).id, 99);
  assert.equal(state.pins[0].folderId, state.folders[0].id);
  await assert.rejects(browser.run('MOVE_TAB', { id: 99, spaceId: 'work' }), /Unpin/);
});

test('a native window move transfers ownership and an existing destination instance wins conflicts', async () => {
  const { browser, page } = await fixture('favorite');
  await browser.api.tabs.move(1, { windowId: 2, index: -1 });
  await browser.controller.tabsChanged();
  assert.equal(owner(await browser.run('GET_STATE', {}, 2), page).id, 1);
  await browser.run('OPEN_PAGE', { id: page.id }, 1);
  const existing = owner(await browser.run(), page);
  await browser.api.tabs.move(1, { windowId: 1, index: -1 });
  await browser.controller.tabsChanged();
  const state = await browser.run();
  assert.equal(owner(state, page).id, existing.id);
  assert.ok(regular(state).some(tab => tab.id === 1));
});

test('a restart reconnects an unambiguous away page and preserves the saved home', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  await browser.controller.tabsChanged();
  browser.restart([tab(91, 'https://away.test/'), tab(92, 'https://other.test/', 1)]);
  const state = await browser.run();
  assert.equal(owner(state, page).id, 91);
  assert.equal(pageSession(page, state.tabs).status, 'away');
  assert.equal(state.pins[0].url, page.url);
  assert.deepEqual(regular(state).map(tab => tab.id), [92]);
});

test('restart duplicate ambiguity leaves tabs regular and no restored tabs means saved items stay closed', async () => {
  const { browser, page } = await fixture();
  const duplicate = await browser.api.tabs.create({ url: page.url, windowId: 1, active: false });
  await browser.controller.tabCreated(duplicate);
  await browser.run();
  browser.restart([tab(91, page.url), tab(92, 'https://other.test/', 1), tab(93, page.url, 2)]);
  let state = await browser.run();
  assert.equal(pageSession(page, state.tabs).status, 'closed');
  assert.equal(regular(state).length, 3);
  browser.restart([]);
  state = await browser.run();
  assert.equal(state.tabs.length, 0);
  assert.equal(state.pins.length, 1);
});

test('late restored URLs recover an owned instance and removing saved records prevents recovery', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  await browser.run();
  browser.restart([tab(91, ''), tab(92, 'https://other.test/', 1)]);
  await browser.run();
  browser.change(91, { url: 'https://away.test/' });
  await browser.controller.tabsChanged();
  assert.equal(owner(await browser.run(), page).id, 91);
  await browser.run('REMOVE_PAGE', { kind: 'pin', id: page.id });
  browser.restart([tab(191, 'https://away.test/'), tab(192, 'https://other.test/', 1)]);
  assert.ok((await browser.run()).tabs.every(tab => tab.savedPageId === null));
});

test('shutdown removal events preserve the saved-owner checkpoint and private instances never reach disk', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  await browser.run();
  browser.setTabs([]);
  await browser.controller.tabRemoved(1, { windowId: 1, isWindowClosing: true });
  browser.restart([tab(91, 'https://away.test/'), tab(92, 'https://other.test/', 1)]);
  assert.equal(owner(await browser.run(), page).id, 91);
  const privateBrowser = fakeBrowser([tab(10, 'https://private.test/', 0, 1, { incognito: true })]);
  const privatePage = (await privateBrowser.run('SAVE_PAGE', { kind: 'pin', tabId: 10 })).pins[0];
  privateBrowser.change(10, { url: 'https://private-away.test/' });
  await privateBrowser.run();
  assert.doesNotMatch(JSON.stringify(privateBrowser.local.workspace), /private/);
  assert.equal(owner(await privateBrowser.run(), privatePage).id, 10);
});

test('migration adopts only clear roots once and cannot infer an already-navigated legacy tab', async () => {
  const browser = fakeBrowser([tab(1, 'https://home.test/'), tab(2, 'https://away.test/', 1)]);
  browser.local.data.pins.push({ id: 'legacy', title: 'Legacy', url: 'https://home.test/', spaceId: 'personal' });
  let state = await browser.run();
  assert.equal(state.tabs[0].savedPageId, 'legacy');
  browser.change(2, { url: 'https://home.test/' });
  state = await browser.run();
  assert.equal(state.tabs[1].savedPageId, null);
  const away = fakeBrowser([tab(1, 'https://away.test/')]);
  away.local.data.pins = browser.local.data.pins;
  assert.equal((await away.run()).tabs[0].savedPageId, null);
  assert.equal(sameUrl('HTTPS://EXAMPLE.COM', 'https://example.com/'), true);
  assert.equal(sameUrl('https://example.com/', 'https://example.com/#other'), false);
});

test('duplicate restored windows do not swap saved owners, and legacy duplicate roots without an active candidate stay regular', async () => {
  const browser = fakeBrowser([tab(1, 'https://same.test/', 0, 1), tab(2, 'https://same.test/', 0, 2)]);
  const page = (await browser.run('SAVE_PAGE', { kind: 'favorite', tabId: 1 })).favorites[0];
  await browser.run('OPEN_PAGE', { id: page.id }, 2);
  browser.restart([tab(91, page.url, 0, 7), tab(92, page.url, 0, 8)]);
  assert.equal((await browser.run('GET_STATE', {}, 7)).tabs[0].savedPageId, null);
  assert.equal((await browser.run('GET_STATE', {}, 8)).tabs[0].savedPageId, null);
  const legacy = fakeBrowser([tab(1, 'https://other.test/'), tab(2, page.url, 1), tab(3, page.url, 2)]);
  legacy.local.data.favorites.push(page);
  assert.ok((await legacy.run()).tabs.every(tab => !tab.savedPageId));
});

test('a regular tab opened from a saved page never inherits ownership, even at the saved root', async () => {
  const { browser, page } = await fixture();
  const child = await browser.api.tabs.create({ url: page.url, windowId: 1, active: false });
  browser.change(child.id, { openerTabId: 1 });
  await browser.controller.tabCreated({ ...child, openerTabId: 1 });
  const state = await browser.run();
  assert.equal(owner(state, page).id, 1);
  assert.ok(regular(state).some(tab => tab.id === child.id));
});

test('removing a closed saved item clears known restore ownership and import/export never includes running ownership', async () => {
  const { browser, page } = await fixture();
  browser.change(1, { url: 'https://away.test/' });
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  assert.equal(browser.live.closedPages[0].pageId, page.id);
  const exported = (await browser.run('EXPORT_DATA')).exportDocument;
  assert.doesNotMatch(JSON.stringify(exported), /savedPageId|pageOwners|ownerSnapshots|closedPages|away.test/);
  await browser.run('REMOVE_PAGE', { kind: 'pin', id: page.id });
  const state = await browser.run('RESTORE_TAB');
  assert.ok(state.tabs.every(tab => !tab.savedPageId));
  assert.equal(browser.live.closedPages.length, 0);
});

test('import does not take ownership of live tabs, including an initially unknown URL', async () => {
  const browser = fakeBrowser([tab(1, ''), tab(2, 'https://imported.test/', 1)]);
  const document = { format: 'arclet', version: 1, favorites: [{ url: 'https://imported.test/', title: 'Imported' }] };
  const preview = (await browser.run('PREVIEW_IMPORT', { document })).importPreview;
  await browser.run('IMPORT_DATA', { document, token: preview.token });
  browser.change(1, { url: 'https://imported.test/' });
  const state = await browser.run();
  assert.ok(state.tabs.every(tab => tab.savedPageId === null));
  assert.equal(pageSession(state.favorites[0], state.tabs).status, 'closed');
});

test('preview restore resumes the saved instance with its original Back/Forward history', async () => {
  const api = createDemoApi();
  const controller = createController(api);
  const run = (type, payload = {}) => controller.dispatch({ type, payload, windowId: 1 });
  const page = (await run('GET_STATE')).pins[0];
  await run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  await run('CLOSE_SAVED_PAGE', { id: page.id });
  const restored = await run('RESTORE_TAB');
  assert.equal(owner(restored, page).url, 'https://www.are.na/explore');
  const forward = await run('NAVIGATE_ACTIVE_TAB', { direction: 'forward' });
  assert.equal(owner(forward, page).url, page.url);
  assert.equal(pageSession(page, forward.tabs).status, 'home');
});

test('after migration, a new root tab on a later restart is not mistaken for a restored saved instance', async () => {
  const { browser, page } = await fixture();
  await browser.run('CLOSE_SAVED_PAGE', { id: page.id });
  browser.restart([tab(99, page.url)]);
  const state = await browser.run();
  assert.equal(pageSession(page, state.tabs).status, 'closed');
  assert.equal(state.tabs[0].savedPageId, null);
  assert.equal(regular(state).length, 1);
});

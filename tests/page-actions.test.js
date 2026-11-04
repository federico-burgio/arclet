import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { createDemoApi } from '../src/demo.js';
import { createController } from '../src/controller.js';

test('Back and Forward target the current active tab in the requesting window', async () => {
  const browser = fakeBrowser([
    tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1), tab(3, 'https://c.test/', 0, 2)
  ]);
  await browser.run('SELECT_SPACE', { id: 'work' });
  await browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  browser.change(1, { active: false });
  browser.change(2, { active: true });
  await browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'forward' });
  await browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'back' }, 2);
  assert.deepEqual(browser.navigated, [
    { id: 1, direction: 'back' }, { id: 2, direction: 'forward' }, { id: 3, direction: 'back' }
  ]);
});

test('navigation validates direction and window and recovers after unavailable history', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await assert.rejects(browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'elsewhere' }), /Back or Forward/);
  await assert.rejects(browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'back' }, 2), /Open a page first/);
  assert.deepEqual(browser.navigated, []);
  const back = browser.api.tabs.goBack;
  browser.api.tabs.goBack = async () => { throw new Error('No previous page in this tab.'); };
  await assert.rejects(browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'back' }), /No previous page/);
  browser.api.tabs.goBack = back;
  await browser.run('NAVIGATE_ACTIVE_TAB', { direction: 'forward' });
  assert.deepEqual(browser.navigated, [{ id: 1, direction: 'forward' }]);
});

test('preview history navigates round-trip without changing tabs or saved URLs', async () => {
  const controller = createController(createDemoApi());
  const run = (type, payload = {}) => controller.dispatch({ type, payload, windowId: 1 });
  const initial = await run('GET_STATE');
  let state = await run('NAVIGATE_ACTIVE_TAB', { direction: 'back' });
  assert.equal(state.tabs.find(tab => tab.active).url, 'https://www.are.na/explore');
  await assert.rejects(run('NAVIGATE_ACTIVE_TAB', { direction: 'back' }), /No previous page/);
  state = await run('NAVIGATE_ACTIVE_TAB', { direction: 'forward' });
  assert.equal(state.tabs.find(tab => tab.active).url, 'https://www.are.na/');
  assert.deepEqual(state.pins, initial.pins);
  assert.deepEqual(state.favorites, initial.favorites);
  assert.equal(state.tabs.length, initial.tabs.length);
  await assert.rejects(run('NAVIGATE_ACTIVE_TAB', { direction: 'forward' }), /No next page/);
});

test('refresh targets the active tab in the requesting window even when another space is selected', async () => {
  const browser = fakeBrowser([
    tab(1, 'https://active.test/'),
    tab(2, 'https://other.test/', 1),
    tab(3, 'https://other-window.test/', 0, 2)
  ]);
  await browser.run('SELECT_SPACE', { id: 'work' });
  await browser.run('RELOAD_ACTIVE_TAB');
  assert.deepEqual(browser.reloaded, [1]);
  browser.change(1, { active: false });
  browser.change(2, { active: true, url: 'https://navigated.test/' });
  await browser.run('RELOAD_ACTIVE_TAB');
  await browser.run('RELOAD_ACTIVE_TAB', {}, 2);
  assert.deepEqual(browser.reloaded, [1, 2, 3]);
  assert.equal((await browser.run()).tabs.length, 2);
});

test('refresh handles missing active tabs and propagates Chrome failures without breaking later actions', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await assert.rejects(browser.run('RELOAD_ACTIVE_TAB', {}, 2), /Open a page first/);
  assert.deepEqual(browser.reloaded, []);
  const reload = browser.api.tabs.reload;
  browser.api.tabs.reload = async () => { throw new Error('Reload unavailable'); };
  await assert.rejects(browser.run('RELOAD_ACTIVE_TAB'), /Reload unavailable/);
  browser.api.tabs.reload = reload;
  await browser.run('RELOAD_ACTIVE_TAB');
  assert.deepEqual(browser.reloaded, [1]);
});

test('middle-click closing protects native pins, saved pins, favorites, and other windows', async () => {
  const browser = fakeBrowser([
    tab(1, 'https://ordinary.test/'),
    tab(2, 'https://native-pin.test/', 1, 1, { pinned: true }),
    tab(3, 'https://saved-pin.test/', 2),
    tab(4, 'https://favorite.test/', 3),
    tab(5, 'https://other-window.test/', 0, 2)
  ]);
  await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 3 });
  await browser.run('SAVE_PAGE', { kind: 'favorite', tabId: 4 });
  for (const id of [2, 3, 4]) {
    await assert.rejects(browser.run('CLOSE_REGULAR_TAB', { id }), /Pinned and favorite tabs/);
  }
  await assert.rejects(browser.run('CLOSE_REGULAR_TAB', { id: 5 }), /another window/);
  const state = await browser.run('CLOSE_REGULAR_TAB', { id: 1 });
  assert.deepEqual(state.tabs.map(tab => tab.id), [2, 3, 4]);
  assert.equal(browser.live.tabSpaces[1], undefined);
  assert.ok((await browser.run('RESTORE_TAB')).tabs.some(tab => tab.url === 'https://ordinary.test/'));
});

test('middle-click uses current saved-page state when a stale row has just been pinned or favorited', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  const pin = (await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 })).pins[0];
  await assert.rejects(browser.run('CLOSE_REGULAR_TAB', { id: 1 }), /Pinned and favorite tabs/);
  await browser.run('REMOVE_PAGE', { kind: 'pin', id: pin.id });
  await browser.run('SAVE_PAGE', { kind: 'favorite', tabId: 1 });
  await assert.rejects(browser.run('CLOSE_REGULAR_TAB', { id: 1 }), /Pinned and favorite tabs/);
  assert.equal((await browser.run()).tabs.length, 2);
  await assert.rejects(browser.run('CLOSE_REGULAR_TAB', { id: 999 }), /No such tab/);
  assert.equal((await browser.run('CLOSE_REGULAR_TAB', { id: 2 })).tabs.length, 1);
});

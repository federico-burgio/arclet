import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';

test('saved pages reuse a matching tab and reopen after it closes', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  let state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  const pin = state.pins[0];
  assert.equal((await browser.run('OPEN_PAGE', { id: pin.id })).tabs.length, 1);
  await assert.rejects(browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 }), /already saved/);
  await browser.run('CLOSE_TAB', { id: 1 });
  state = await browser.run('OPEN_PAGE', { id: pin.id });
  assert.equal(state.tabs[0].url, 'https://a.test/');
});

test('concurrent commands retain all changes and failed commands do not poison the queue', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await assert.rejects(browser.run('MOVE_TAB', { id: 1, spaceId: 'missing' }));
  await Promise.all([
    browser.run('SAVE_SPACE', { name: 'Reading', color: 'sand', icon: 'coffee' }),
    browser.run('SAVE_SPACE', { name: 'Projects', color: 'ocean', icon: 'globe' }),
    browser.run('SET_THEME', { theme: 'dark' })
  ]);
  const state = await browser.run();
  assert.equal(state.spaces.length, 4);
  assert.equal(state.theme, 'dark');
});

test('deleting spaces preserves tabs and pinned pages', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await browser.run('SELECT_SPACE', { id: 'work' });
  await browser.run('SAVE_PAGE', { tabId: 1, kind: 'pin' });
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  const state = await browser.run('DELETE_SPACE', { id: 'work' });
  assert.equal(state.tabs[0].spaceId, 'personal');
  assert.equal(state.pins[0].spaceId, 'personal');
  await assert.rejects(browser.run('DELETE_SPACE', { id: 'personal' }), /at least one/);
});

test('commands cannot act on another window’s tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 0, 2)]);
  for (const type of ['ACTIVATE_TAB', 'CLOSE_TAB', 'MOVE_TAB', 'SAVE_PAGE', 'MUTE_TAB', 'REORDER_TAB']) {
    await assert.rejects(browser.run(type, { id: 2, tabId: 2, spaceId: 'work', targetId: 1 }), /another window/);
  }
});

test('new external tabs inherit their opener and activation selects their space', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  browser.setTabs([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1, 1, { openerTabId: 1 })]);
  await browser.controller.tabCreated(await browser.api.tabs.get(2));
  await browser.controller.tabActivated({ tabId: 2, windowId: 1 });
  const state = await browser.run();
  assert.equal(state.tabs[1].spaceId, 'work');
  assert.equal(state.spaceId, 'work');
});

test('mute, reorder, close and restore keep working', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  assert.equal((await browser.run('MUTE_TAB', { id: 2 })).tabs[1].mutedInfo.muted, true);
  assert.equal((await browser.run('REORDER_TAB', { id: 2, targetId: 1 })).tabs[0].id, 2);
  await browser.run('CLOSE_TAB', { id: 2 });
  assert.ok((await browser.run('RESTORE_TAB')).tabs.some(tab => tab.url === 'https://b.test/'));
  browser.change(1, { pinned: true });
  const other = (await browser.run()).tabs.find(tab => tab.id !== 1);
  await assert.rejects(browser.run('REORDER_TAB', { id: 1, targetId: other.id }), /pinned tabs/);
});

test('invalid settings and non-web saved pages are rejected', async () => {
  const browser = fakeBrowser([tab(1, 'chrome://newtab/')]);
  await assert.rejects(browser.run('SAVE_SPACE', { name: ' ', color: 'iris', icon: 'sun' }), /name/);
  await assert.rejects(browser.run('SAVE_SPACE', { name: 'Test', color: '__proto__', icon: 'sun' }), /color/);
  await assert.rejects(browser.run('SAVE_SPACE', { name: 'Test', color: 'iris', icon: 'invalid' }), /icon/);
  await assert.rejects(browser.run('SAVE_PAGE', { tabId: 1, kind: 'favorite' }), /http and https/);
});

test('search visibility defaults on for older settings and persists across windows and restarts', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  delete browser.local.data.showSearchBar;
  assert.equal((await browser.run()).showSearchBar, true);
  await browser.run('SET_SEARCH_VISIBILITY', { visible: false });
  assert.equal((await browser.run('GET_STATE', {}, 2)).showSearchBar, false);
  browser.restart([tab(11, 'https://a.test/')]);
  assert.equal((await browser.run()).showSearchBar, false);
  assert.equal((await browser.run('SET_SEARCH_VISIBILITY', { visible: true })).showSearchBar, true);
  await assert.rejects(browser.run('SET_SEARCH_VISIBILITY', { visible: 'false' }), /whether to show/);
});

test('favorite labels default on for older settings and stay hidden after restart', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  delete browser.local.data.showFavoriteLabels;
  assert.equal((await browser.run()).showFavoriteLabels, true);
  await browser.run('SET_FAVORITE_LABELS', { visible: false });
  assert.equal((await browser.run('GET_STATE', {}, 2)).showFavoriteLabels, false);
  browser.restart([tab(11, 'https://a.test/')]);
  assert.equal((await browser.run()).showFavoriteLabels, false);
  assert.equal((await browser.run('SET_FAVORITE_LABELS', { visible: true })).showFavoriteLabels, true);
  await assert.rejects(browser.run('SET_FAVORITE_LABELS', { visible: 'false' }), /whether to show/);
});

test('a closed pinned page can become a favorite without opening a tab', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/', 0, 1, { title: 'Reading notes' })]);
  const pin = (await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 })).pins[0];
  await browser.run('CLOSE_TAB', { id: 1 });
  const state = await browser.run('SAVE_PAGE', { kind: 'favorite', pageId: pin.id });
  assert.equal(state.favorites[0].url, pin.url);
  assert.equal(state.favorites[0].title, 'Reading notes');
  assert.equal(state.tabs.length, 0);
  assert.equal(state.pins.length, 1);
  await assert.rejects(browser.run('SAVE_PAGE', { kind: 'favorite', pageId: pin.id }), /already saved/);
  await assert.rejects(browser.run('SAVE_PAGE', { kind: 'favorite', pageId: 'missing' }), /no longer exists/);
  browser.local.data.pins.push({ id: 'unsafe', url: 'javascript:alert(1)', title: 'Unsafe', spaceId: 'personal' });
  await assert.rejects(browser.run('SAVE_PAGE', { kind: 'favorite', pageId: 'unsafe' }), /http and https/);
});

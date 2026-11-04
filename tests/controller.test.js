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

test('optional background color upgrades older settings, persists globally, and resets to the current theme', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  delete browser.local.data.backgroundColor;
  assert.equal((await browser.run()).backgroundColor, null);
  await browser.run('SET_BACKGROUND_COLOR', { color: '#A1B2C3' });
  assert.equal((await browser.run('GET_STATE', {}, 2)).backgroundColor, '#a1b2c3');
  await browser.run('SELECT_SPACE', { id: 'work' });
  assert.equal((await browser.run('SET_THEME', { theme: 'dark' })).backgroundColor, '#a1b2c3');
  browser.restart([tab(11, 'https://a.test/')]);
  let state = await browser.run();
  assert.equal(state.backgroundColor, '#a1b2c3');
  assert.equal(state.theme, 'dark');
  assert.equal(state.spaces[0].color, 'slate');
  state = await browser.run('SET_BACKGROUND_COLOR', { color: null });
  assert.equal(state.backgroundColor, null);
  assert.equal(state.theme, 'dark');
  assert.equal((await browser.run('SET_THEME', { theme: 'system' })).backgroundColor, null);
  browser.suspend();
  assert.equal((await browser.run()).backgroundColor, null);
});

test('favorites per row defaults to four and persists independently across windows and restarts', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  delete browser.local.data.favoritesPerRow;
  assert.equal((await browser.run()).favoritesPerRow, 4);
  await browser.run('SAVE_PAGE', { kind: 'favorite', tabId: 1 });
  const favorites = (await browser.run()).favorites;
  assert.equal((await browser.run('SET_FAVORITES_PER_ROW', { count: 1 })).favoritesPerRow, 1);
  assert.equal((await browser.run('GET_STATE', {}, 2)).favoritesPerRow, 1);
  await browser.run('SET_FAVORITES_PER_ROW', { count: 8 });
  await browser.run('SET_FAVORITE_LABELS', { visible: false });
  await browser.run('SELECT_SPACE', { id: 'work' });
  browser.restart([tab(11, 'https://a.test/')]);
  let state = await browser.run();
  assert.equal(state.favoritesPerRow, 8);
  assert.equal(state.showFavoriteLabels, false);
  assert.deepEqual(state.favorites, favorites);
  state = await browser.run('SET_FAVORITES_PER_ROW', { count: 4 });
  assert.equal(state.favoritesPerRow, 4);
  browser.suspend();
  assert.equal((await browser.run()).favoritesPerRow, 4);
});

test('invalid favorites row counts cannot overwrite the saved preference', async () => {
  const browser = fakeBrowser();
  await browser.run('SET_FAVORITES_PER_ROW', { count: 3 });
  for (const count of [undefined, null, 0, -1, 9, 2.5, '4', true, {}, Infinity, NaN]) {
    await assert.rejects(browser.run('SET_FAVORITES_PER_ROW', { count }), /between 1 and 8/);
    assert.equal((await browser.run()).favoritesPerRow, 3);
  }
});

test('font size defaults to 100% and persists across windows, spaces, themes, and restarts', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  delete browser.local.data.fontScale;
  assert.equal((await browser.run()).fontScale, 100);
  for (const scale of [90, 110, 125, 150]) {
    assert.equal((await browser.run('SET_FONT_SCALE', { scale })).fontScale, scale);
  }
  assert.equal((await browser.run('GET_STATE', {}, 2)).fontScale, 150);
  await browser.run('SET_FAVORITES_PER_ROW', { count: 2 });
  await browser.run('SELECT_SPACE', { id: 'work' });
  await browser.run('SET_THEME', { theme: 'dark' });
  browser.restart([tab(11, 'https://a.test/')]);
  const state = await browser.run();
  assert.equal(state.fontScale, 150);
  assert.equal(state.favoritesPerRow, 2);
  assert.equal(state.theme, 'dark');
  await browser.run('SET_FONT_SCALE', { scale: 100 });
  browser.suspend();
  assert.equal((await browser.run()).fontScale, 100);
});

test('invalid font scales leave the saved font size unchanged', async () => {
  const browser = fakeBrowser();
  await browser.run('SET_FONT_SCALE', { scale: 125 });
  for (const scale of [undefined, null, 0, -1, 89, 101, 151, 125.5, '100', true, {}, NaN]) {
    await assert.rejects(browser.run('SET_FONT_SCALE', { scale }), /font size from the list/);
    assert.equal((await browser.run()).fontScale, 125);
  }
});

test('invalid background colors leave the saved preference untouched', async () => {
  const browser = fakeBrowser();
  await browser.run('SET_BACKGROUND_COLOR', { color: '#123456' });
  for (const color of [undefined, '', '#fff', '#12345g', 'red', 'url(https://example.com)', 123456, {}]) {
    await assert.rejects(browser.run('SET_BACKGROUND_COLOR', { color }), /valid background color/);
    assert.equal((await browser.run()).backgroundColor, '#123456');
  }
});

test('custom space backgrounds persist independently of palettes, icon colors, themes, and the main background', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  assert.equal((await browser.run()).spaces[0].backgroundColor ?? null, null);
  await browser.run('SET_BACKGROUND_COLOR', { color: '#123456' });
  let state = await browser.run('SAVE_SPACE', { name: 'Reading', color: 'sage', backgroundColor: '#C8D8E8', icon: 'book', iconColor: '#654321' });
  const id = state.spaceId;
  const space = () => state.spaces.find(space => space.id === id);
  assert.equal(space().backgroundColor, '#c8d8e8');
  assert.equal(space().color, 'sage');
  assert.equal(space().iconColor, '#654321');
  state = await browser.run('SET_THEME', { theme: 'dark' });
  assert.equal(space().backgroundColor, '#c8d8e8');
  state = await browser.run('GET_STATE', {}, 2);
  assert.equal(space().backgroundColor, '#c8d8e8');
  browser.restart([tab(11, 'https://a.test/')]);
  state = await browser.run();
  assert.equal(space().backgroundColor, '#c8d8e8');
  assert.equal(state.backgroundColor, '#123456');
  // Older clients editing unrelated fields do not discard the custom background.
  state = await browser.run('SAVE_SPACE', { id, name: 'Books', color: 'rose', icon: 'book' });
  assert.equal(space().backgroundColor, '#c8d8e8');
  state = await browser.run('SAVE_SPACE', { id, name: 'Books', color: 'rose', backgroundColor: null, icon: 'book' });
  assert.equal(space().backgroundColor, null);
  assert.equal(space().color, 'rose');
  assert.equal(state.backgroundColor, '#123456');
  browser.suspend();
  assert.equal((await browser.run()).spaces.find(space => space.id === id).backgroundColor, null);
});

test('invalid custom space backgrounds cannot alter or create spaces', async () => {
  const browser = fakeBrowser();
  const original = (await browser.run()).spaces;
  for (const backgroundColor of ['', '#fff', 'red', '#12345g', 'url(https://example.com)', 123, {}]) {
    for (const id of [undefined, 'personal']) {
      await assert.rejects(browser.run('SAVE_SPACE', { id, name: 'Changed', color: 'sage', backgroundColor, icon: 'book' }), /valid space background color/);
      assert.deepEqual((await browser.run()).spaces, original);
    }
  }
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';

const assigned = state => state.tabs.map(tab => [tab.id, tab.spaceId]);

test('Chrome restart restores assignments and selected space with entirely new IDs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/', 0), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  await browser.run('SELECT_SPACE', { id: 'work' });
  browser.restart([tab(91, 'https://a.test/', 0, 50), tab(92, 'https://b.test/', 1, 50)]);
  const state = await browser.run('GET_STATE', {}, 50);
  assert.deepEqual(assigned(state), [[91, 'personal'], [92, 'work']]);
  assert.equal(state.spaceId, 'work');
  assert.equal(browser.local.workspace.windows.length, 1);
});

test('a reused tab ID does not give an unrelated page an old assignment', async () => {
  const browser = fakeBrowser([tab(1, 'https://old.test/')]);
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  browser.restart([tab(1, 'https://unrelated.test/')]);
  assert.deepEqual(assigned(await browser.run()), [[1, 'personal']]);
});

test('duplicate URLs in different spaces recover one-to-one by order and pinned state', async () => {
  const browser = fakeBrowser([tab(1, 'https://same.test/', 0), tab(2, 'https://same.test/', 1), tab(3, 'https://same.test/', 2)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.restart([tab(20, 'https://same.test/', 0), tab(10, 'https://same.test/', 1), tab(30, 'https://same.test/', 2)]);
  assert.deepEqual(assigned(await browser.run()), [[20, 'personal'], [10, 'work'], [30, 'personal']]);
});

test('multiple windows recover independently when their IDs and creation order change', async () => {
  const original = [tab(1, 'https://same.test/', 0, 1), tab(2, 'https://a.test/', 1, 1), tab(3, 'https://same.test/', 0, 2), tab(4, 'https://b.test/', 1, 2)];
  const browser = fakeBrowser(original);
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  await browser.run('MOVE_TAB', { id: 4, spaceId: 'work' }, 2);
  await browser.run('SELECT_SPACE', { id: 'work' }, 1);
  browser.restart([tab(11, 'https://same.test/', 0, 100), tab(12, 'https://b.test/', 1, 100), tab(13, 'https://same.test/', 0, 200), tab(14, 'https://a.test/', 1, 200)]);
  assert.deepEqual(assigned(await browser.run('GET_STATE', {}, 100)), [[11, 'personal'], [12, 'work']]);
  const a = await browser.run('GET_STATE', {}, 200);
  assert.deepEqual(assigned(a), [[13, 'work'], [14, 'personal']]);
  assert.equal(a.spaceId, 'work');
});

test('late URLs recover without a panel being open or losing the old checkpoint', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.restart([tab(11, ''), tab(12, '', 1)]);
  await browser.controller.initialize();
  assert.ok(browser.local.workspace.windows.some(window => window.tabs.some(tab => tab.url === 'https://b.test/')));
  browser.change(11, { url: 'https://a.test/' });
  await browser.controller.tabsChanged();
  browser.suspend();
  browser.change(12, { url: 'https://b.test/' });
  await browser.controller.tabsChanged();
  assert.deepEqual(assigned(await browser.run()), [[11, 'personal'], [12, 'work']]);
});

test('an ambiguous early shared tab waits for the identifying window pages', async () => {
  const browser = fakeBrowser([tab(1, 'https://same.test/', 0, 1), tab(2, 'https://a.test/', 1, 1), tab(3, 'https://same.test/', 0, 2), tab(4, 'https://b.test/', 1, 2)]);
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  await browser.run('MOVE_TAB', { id: 4, spaceId: 'work' }, 2);
  browser.restart([tab(11, 'https://same.test/', 0, 7)]);
  await browser.controller.initialize();
  browser.setTabs([tab(11, 'https://same.test/', 0, 7), tab(12, 'https://b.test/', 1, 7), tab(13, 'https://same.test/', 0, 8), tab(14, 'https://a.test/', 1, 8)]);
  await browser.controller.tabsChanged();
  assert.deepEqual(assigned(await browser.run('GET_STATE', {}, 7)), [[11, 'personal'], [12, 'work']]);
  assert.deepEqual(assigned(await browser.run('GET_STATE', {}, 8)), [[13, 'work'], [14, 'personal']]);
});

test('a second restart during partial recovery still recovers the missing tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.restart([tab(11, 'https://a.test/')]);
  await browser.controller.initialize();
  browser.restart([tab(21, 'https://a.test/'), tab(22, 'https://b.test/', 1)]);
  assert.deepEqual(assigned(await browser.run()), [[21, 'personal'], [22, 'work']]);
});

test('duplicate late URLs are not consumed out of their restored order', async () => {
  const browser = fakeBrowser([tab(1, 'https://same.test/'), tab(2, 'https://same.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.restart([tab(11, ''), tab(12, '', 1)]);
  await browser.controller.initialize();
  browser.change(12, { url: 'https://same.test/' });
  await browser.controller.tabsChanged();
  browser.change(11, { url: 'https://same.test/' });
  await browser.controller.tabsChanged();
  assert.deepEqual(assigned(await browser.run()), [[11, 'personal'], [12, 'work']]);
});

test('shutdown removal events preserve the last window checkpoint', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.setTabs([]);
  await browser.controller.tabRemoved(1, { windowId: 1, isWindowClosing: true });
  await browser.controller.tabRemoved(2, { windowId: 1, isWindowClosing: true });
  await browser.controller.windowRemoved(1);
  assert.equal(browser.local.workspace.windows[0].tabs.length, 2);
  browser.restart([tab(101, 'https://a.test/'), tab(102, 'https://b.test/', 1)]);
  assert.deepEqual(assigned(await browser.run()), [[101, 'personal'], [102, 'work']]);
});

test('a deliberately closed tab is removed from the checkpoint and not resurrected', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  await browser.api.tabs.remove(2);
  await browser.controller.tabRemoved(2, { windowId: 1, isWindowClosing: false });
  assert.ok(browser.local.workspace.windows.every(window => window.tabs.every(tab => tab.url !== 'https://b.test/')));
  browser.restart([tab(11, 'https://a.test/')]);
  await browser.run();
  const state = await browser.run('NEW_TAB', { input: 'https://b.test/' });
  assert.equal(state.tabs.find(tab => tab.url === 'https://b.test/').spaceId, 'personal');
});

test('newly opened copies do not consume a missing restored tab’s assignment', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.restart([tab(11, 'https://a.test/')]);
  await browser.run();
  const newState = await browser.run('NEW_TAB', { input: 'https://b.test/' });
  const copy = newState.tabs.find(tab => tab.url === 'https://b.test/');
  browser.setTabs([...newState.tabs, tab(12, 'https://b.test/', 2)]);
  await browser.controller.tabsChanged();
  const state = await browser.run();
  assert.equal(state.tabs.find(tab => tab.id === copy.id).spaceId, 'personal');
  assert.equal(state.tabs.find(tab => tab.id === 12).spaceId, 'work');
});

test('navigation, pending URLs, and native reordering update the checkpoint', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://old.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.change(2, { pendingUrl: 'https://new.test/' });
  await browser.controller.tabsChanged();
  await browser.api.tabs.move(2, { index: 0 });
  await browser.controller.tabsChanged();
  browser.restart([tab(12, 'https://new.test/'), tab(11, 'https://a.test/', 1)]);
  assert.deepEqual(assigned(await browser.run()), [[12, 'work'], [11, 'personal']]);
});

test('moving tabs across windows and replacing a tab retain its durable record', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1), tab(3, 'https://c.test/', 0, 2)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  await browser.api.tabs.move(2, { windowId: 2, index: 1 });
  await browser.controller.tabsChanged();
  browser.change(2, { id: 20 });
  await browser.controller.tabReplaced(20, 2);
  browser.restart([tab(11, 'https://a.test/', 0, 5), tab(13, 'https://c.test/', 0, 6), tab(12, 'https://b.test/', 1, 6)]);
  assert.deepEqual(assigned(await browser.run('GET_STATE', {}, 6)), [[13, 'personal'], [12, 'work']]);
});

test('moving a window’s last tab removes its old checkpoint record', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 0, 2)]);
  await browser.run('MOVE_TAB', { id: 1, spaceId: 'work' });
  await browser.api.tabs.move(1, { windowId: 2, index: 1 });
  await browser.controller.windowRemoved(1);
  const records = browser.local.workspace.windows.flatMap(window => window.tabs);
  assert.equal(records.filter(record => record.url === 'https://a.test/').length, 1);
  browser.restart([tab(12, 'https://b.test/', 0, 5), tab(11, 'https://a.test/', 1, 5)]);
  assert.deepEqual(assigned(await browser.run('GET_STATE', {}, 5)), [[12, 'personal'], [11, 'work']]);
});

test('deleted spaces never return through a restart checkpoint', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' });
  browser.restart([tab(11, 'https://a.test/')]);
  await browser.run('DELETE_SPACE', { id: 'work' });
  browser.restart([tab(21, 'https://a.test/'), tab(22, 'https://b.test/', 1)]);
  assert.deepEqual(assigned(await browser.run()), [[21, 'personal'], [22, 'personal']]);
});

test('worker suspension and upgrading a live 0.1 session keep existing assignments', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', 1)]);
  await browser.api.storage.session.set({ live: { tabSpaces: { 1: 'work', 2: 'personal' }, windowSpaces: { 1: 'work' } } });
  await browser.controller.initialize();
  browser.suspend();
  assert.deepEqual(assigned(await browser.run()), [[1, 'work'], [2, 'personal']]);
  browser.restart([tab(11, 'https://a.test/'), tab(12, 'https://b.test/', 1)]);
  assert.deepEqual(assigned(await browser.run()), [[11, 'work'], [12, 'personal']]);
});

test('private URLs are never written into the persistent checkpoint', async () => {
  const browser = fakeBrowser([tab(1, 'https://public.test/'), tab(2, 'https://private.test/', 0, 2, { incognito: true })]);
  await browser.run('MOVE_TAB', { id: 2, spaceId: 'work' }, 2);
  assert.equal(JSON.stringify(browser.local.workspace).includes('private.test'), false);
  assert.equal((await browser.run('GET_STATE', {}, 2)).tabs[0].spaceId, 'work');
});

test('state reads never write storage, even when every write fails', async () => {
  const browser = fakeBrowser([tab(1, 'https://read.test/')]);
  const fail = async () => { throw new Error('Storage quota exceeded'); };
  browser.api.storage.local.set = fail;
  browser.api.storage.session.set = fail;
  assert.equal((await browser.run()).tabs[0].url, 'https://read.test/');
});

test('checkpoint failures do not prevent settings from saving or state from loading', async () => {
  const browser = fakeBrowser([tab(1, 'https://save.test/')]);
  const set = browser.api.storage.local.set;
  browser.api.storage.local.set = async values => {
    if ('workspace' in values) throw new Error('Storage quota exceeded');
    return set(values);
  };
  await browser.run('SET_THEME', { theme: 'dark' });
  assert.equal(browser.local.data.theme, 'dark');
  assert.equal((await browser.run()).theme, 'dark');
});

test('an old oversized checkpoint is evicted when it blocks a durable settings write', async () => {
  const browser = fakeBrowser();
  browser.local.workspace = { version: 1, windows: [] };
  const set = browser.api.storage.local.set;
  browser.api.storage.local.set = async values => {
    if ('data' in values && browser.local.workspace) throw new Error('QUOTA_BYTES exceeded');
    return set(values);
  };
  assert.equal((await browser.run('SET_THEME', { theme: 'dark' })).theme, 'dark');
  assert.equal(browser.local.data.theme, 'dark');
});

test('checkpoint URLs and total bytes are bounded without truncating addresses', async () => {
  const browser = fakeBrowser([
    tab(1, `data:text/plain,${'x'.repeat(2 * 1024 * 1024)}`),
    ...Array.from({ length: 200 }, (_, i) => tab(i + 2, `https://bounded.test/${i}?q=${'x'.repeat(8000)}`, i + 1))
  ]);
  await browser.controller.initialize();
  assert.ok(new TextEncoder().encode(JSON.stringify(browser.local.workspace)).length <= 1024 * 1024);
  const records = browser.local.workspace.windows.flatMap(window => window.tabs);
  assert.ok(records.length > 0 && records.length < 200);
  assert.ok(records.every(record => record.url.startsWith('https://bounded.test/')));
});

test('long sessions trim closed-window flags and recovery markers without erasing shutdown checkpoints', async () => {
  const browser = fakeBrowser();
  for (let id = 1; id <= 40; id++) {
    browser.setTabs([tab(id, `https://session.test/${id}`, 0, id)]);
    await browser.controller.tabCreated(await browser.api.tabs.get(id));
    await browser.run('SELECT_SPACE', { id: 'work' }, id);
    browser.setTabs([]);
    await browser.controller.tabRemoved(id, { windowId: id, isWindowClosing: true });
    await browser.controller.windowRemoved(id);
  }
  assert.deepEqual(browser.live.closingWindows, {});
  assert.deepEqual(browser.live.fixedWindows, {});
  assert.deepEqual(browser.live.windowKeys, {});
  assert.deepEqual(browser.live.recovery.used, {});
  assert.ok(browser.local.workspace.windows.length <= 20);
  browser.restart([tab(101, 'https://session.test/40', 0, 100)]);
  assert.equal((await browser.run('GET_STATE', {}, 100)).spaceId, 'work');
});

test('closing newly created tabs does not accumulate irrelevant consumed-record markers', async () => {
  const browser = fakeBrowser([tab(1, 'https://keeper.test/')]);
  for (let index = 0; index < 40; index++) {
    const state = await browser.run('NEW_TAB', { input: `https://temporary.test/${index}` });
    const created = state.tabs.find(tab => tab.url.includes('temporary.test'));
    await browser.run('CLOSE_TAB', { id: created.id });
  }
  assert.deepEqual(browser.live.recovery.used, {});
  assert.equal((await browser.run()).tabs.length, 1);
});

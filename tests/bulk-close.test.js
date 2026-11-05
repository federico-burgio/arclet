import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';

async function fixture() {
  const browser = fakeBrowser([
    tab(1, 'https://above.test/', 0),
    tab(2, 'https://pin.test/', 1),
    tab(3, 'https://favorite.test/', 2),
    tab(4, 'https://anchor.test/', 3),
    tab(5, 'https://other-space.test/', 4),
    tab(6, 'https://below.test/', 5),
    tab(7, 'https://pin.test/', 6),
    tab(8, 'https://favorite.test/', 7),
    tab(9, 'https://last.test/', 8),
    tab(10, 'https://other-window.test/', 0, 2)
  ]);
  await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 2 });
  await browser.run('SAVE_PAGE', { kind: 'favorite', tabId: 3 });
  await browser.run('MOVE_TAB', { id: 5, spaceId: 'work' });
  return browser;
}
const ids = async browser => (await browser.api.tabs.query({})).map(tab => tab.id);

test('broom cleanup preserves Chrome pins, Arclet pins, favorites, and other spaces and windows', async () => {
  const browser = await fixture();
  browser.change(1, { pinned: true });
  const before = await browser.run();
  const state = await browser.run('CLOSE_OPEN_TABS', { mode: 'regular', spaceId: 'personal' });
  assert.deepEqual(await ids(browser), [1, 2, 3, 5, 10]);
  assert.deepEqual(state.pins, before.pins);
  assert.deepEqual(state.favorites, before.favorites);
  assert.equal(browser.live.tabSpaces[1], 'personal');
  for (const id of [4, 6, 9]) assert.equal(browser.live.tabSpaces[id], undefined);
  assert.ok((await browser.run('RESTORE_TAB')).tabs.some(tab => tab.url === 'https://last.test/'));
});

test('broom cleanup is a no-op when a space has only protected tabs', async () => {
  const browser = await fixture();
  await browser.run('CLOSE_OPEN_TABS', { mode: 'regular', spaceId: 'personal' });
  const remaining = await ids(browser);
  await browser.run('CLOSE_OPEN_TABS', { mode: 'regular', spaceId: 'personal' });
  assert.deepEqual(await ids(browser), remaining);
});

test('close all affects only visible open tabs in the requested space and window', async () => {
  const browser = await fixture();
  const before = await browser.run();
  const state = await browser.run('CLOSE_OPEN_TABS', { mode: 'all', spaceId: 'personal' });
  assert.deepEqual(await ids(browser), [2, 3, 5, 10]);
  assert.deepEqual(state.pins, before.pins);
  assert.deepEqual(state.favorites, before.favorites);
  for (const id of [1, 4, 6, 9]) assert.equal(browser.live.tabSpaces[id], undefined);
  const recorded = browser.local.workspace.windows.flatMap(window => window.tabs.map(tab => tab.url));
  for (const url of ['https://above.test/', 'https://anchor.test/', 'https://below.test/', 'https://last.test/']) assert.ok(!recorded.includes(url));
  // Repeating on an empty list is safe, and closed tabs remain restorable.
  await browser.run('CLOSE_OPEN_TABS', { mode: 'all', spaceId: 'personal' });
  assert.deepEqual(await ids(browser), [2, 3, 5, 10]);
  const restored = await browser.run('RESTORE_TAB');
  assert.ok(restored.tabs.some(tab => tab.url === 'https://last.test/'));
});

test('close below follows the displayed Chrome order and leaves the anchor open', async () => {
  const browser = await fixture();
  await browser.run('CLOSE_OPEN_TABS', { mode: 'below', id: 4, spaceId: 'personal' });
  assert.deepEqual(await ids(browser), [1, 2, 3, 4, 5, 10]);
});

test('close below is a no-op for the last visible tab, including hidden rows afterward', async () => {
  const browser = await fixture();
  const before = await ids(browser);
  await browser.run('CLOSE_OPEN_TABS', { mode: 'below', id: 9, spaceId: 'personal' });
  assert.deepEqual(await ids(browser), before);
  await browser.run('REORDER_TAB', { id: 9, targetId: 4 });
  await browser.run('CLOSE_OPEN_TABS', { mode: 'below', id: 9, spaceId: 'personal' });
  // Independent duplicates 7 and 8 are regular tabs; only owned saved instances survive.
  assert.deepEqual((await ids(browser)).sort((a, b) => a - b), [1, 2, 3, 5, 9, 10]);
});

test('invalid or stale close-below anchors cannot close other tabs or windows', async () => {
  const browser = await fixture();
  const before = await ids(browser);
  for (const payload of [
    { mode: 'below', id: 10, spaceId: 'personal' },
    { mode: 'below', id: 2, spaceId: 'personal' },
    { mode: 'below', id: 3, spaceId: 'personal' },
    { mode: 'below', id: 4, spaceId: 'work' },
    { mode: 'below', id: 999, spaceId: 'personal' },
    { mode: 'all', spaceId: 'missing' },
    { mode: 'unknown', spaceId: 'personal' }
  ]) {
    await assert.rejects(browser.run('CLOSE_OPEN_TABS', payload));
    assert.deepEqual(await ids(browser), before);
  }
  await browser.run('MOVE_TAB', { id: 4, spaceId: 'work' });
  await assert.rejects(browser.run('CLOSE_OPEN_TABS', { mode: 'below', id: 4, spaceId: 'personal' }), /no longer/);
  assert.deepEqual(await ids(browser), before);
});

test('confirmed bulk close excludes tabs that arrived after the confirmation opened', async () => {
  const browser = await fixture();
  const approved = [1, 4, 6, 7, 8, 9];
  const before = await browser.api.tabs.query({});
  browser.setTabs([...before, tab(11, 'https://new-arrival.test/', 9)]);
  await browser.run('CLOSE_OPEN_TABS', { mode: 'all', spaceId: 'personal', ids: approved });
  assert.deepEqual(await ids(browser), [2, 3, 5, 10, 11]);
});

test('invalid confirmation targets do not close any tabs', async () => {
  const browser = await fixture();
  const before = await ids(browser);
  await assert.rejects(browser.run('CLOSE_OPEN_TABS', { mode: 'all', ids: ['1'] }), /valid tabs/);
  assert.deepEqual(await ids(browser), before);
});

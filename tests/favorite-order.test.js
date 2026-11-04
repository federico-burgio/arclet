import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { favoriteDropTarget } from '../src/favorite-drag.js';

async function fixture() {
  const browser = fakeBrowser(['a', 'b', 'c', 'd'].map((name, index) => tab(index + 1, `https://${name}.test/`, index)));
  for (const tabId of [1, 2, 3]) await browser.run('SAVE_PAGE', { kind: 'favorite', tabId });
  return { browser, favorites: (await browser.run()).favorites };
}
const urls = state => state.favorites.map(page => page.url);

test('favorites move both ways and retain their appearance across windows and restarts', async () => {
  const { browser, favorites: [a, b, c] } = await fixture();
  await browser.run('SET_PAGE_ICON', { kind: 'favorite', id: b.id, icon: 'heart', iconColor: '#bb5e82' });
  let state = await browser.run('REORDER_FAVORITE', { id: c.id, targetId: a.id, placement: 'before' });
  assert.deepEqual(urls(state), ['https://c.test/', 'https://a.test/', 'https://b.test/']);
  state = await browser.run('REORDER_FAVORITE', { id: a.id, targetId: b.id, placement: 'after' });
  assert.deepEqual(urls(state), ['https://c.test/', 'https://b.test/', 'https://a.test/']);
  assert.deepEqual(urls(await browser.run('GET_STATE', {}, 2)), urls(state));
  browser.suspend();
  assert.deepEqual(urls(await browser.run()), urls(state));
  browser.restart(['a', 'b', 'c', 'd'].map((name, index) => tab(100 + index, `https://${name}.test/`, index)));
  state = await browser.run();
  assert.deepEqual(urls(state), ['https://c.test/', 'https://b.test/', 'https://a.test/']);
  assert.equal(state.favorites[1].iconColor, '#bb5e82');
  assert.equal(state.tabs.length, 4);
});

test('stale favorites and invalid positions fail without losing or reordering saved pages', async () => {
  const { browser, favorites: [a, b] } = await fixture();
  const before = structuredClone(browser.local.data);
  for (const payload of [
    { id: 'missing', targetId: b.id, placement: 'before' },
    { id: a.id, targetId: 'missing', placement: 'after' },
    { id: a.id, targetId: b.id, placement: 'inside' }
  ]) {
    await assert.rejects(browser.run('REORDER_FAVORITE', payload));
    assert.deepEqual(browser.local.data, before);
  }
  assert.deepEqual((await browser.run('REORDER_FAVORITE', { id: a.id, targetId: a.id, placement: 'after' })).favorites, before.favorites);
});

test('serialized favorite reorders preserve additions and removal does not reset order', async () => {
  const { browser, favorites: [a, b, c] } = await fixture();
  await Promise.all([
    browser.run('REORDER_FAVORITE', { id: c.id, targetId: a.id, placement: 'before' }),
    browser.run('REORDER_FAVORITE', { id: a.id, targetId: b.id, placement: 'after' }),
    browser.run('SAVE_PAGE', { kind: 'favorite', tabId: 4 })
  ]);
  let state = await browser.run();
  assert.deepEqual(urls(state), ['https://c.test/', 'https://b.test/', 'https://a.test/', 'https://d.test/']);
  state = await browser.run('REMOVE_PAGE', { kind: 'favorite', id: b.id });
  assert.deepEqual(urls(state), ['https://c.test/', 'https://a.test/', 'https://d.test/']);
});

test('favorite grid drop targets work for card halves, gaps, wrapped rows, and self-drops', () => {
  const tiles = [
    { id: 'a', left: 0, top: 0, width: 100, height: 50 },
    { id: 'b', left: 110, top: 0, width: 100, height: 50 },
    { id: 'c', left: 0, top: 60, width: 100, height: 50 },
    { id: 'd', left: 110, top: 60, width: 100, height: 50 }
  ];
  assert.deepEqual(favoriteDropTarget(tiles, 'a', 120, 25), { targetId: 'b', placement: 'before' });
  assert.deepEqual(favoriteDropTarget(tiles, 'a', 200, 25), { targetId: 'b', placement: 'after' });
  assert.deepEqual(favoriteDropTarget(tiles, 'a', 120, 85), { targetId: 'd', placement: 'before' });
  assert.deepEqual(favoriteDropTarget(tiles, 'd', 104, 25), { targetId: 'a', placement: 'after' });
  assert.equal(favoriteDropTarget(tiles, 'a', 25, 25), null);
  assert.equal(favoriteDropTarget([], 'a', 25, 25), null);
});

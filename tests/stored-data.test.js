import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredData } from '../src/stored-data.js';
import { defaultData } from '../src/model.js';
import { fakeBrowser, tab } from './fake-browser.js';

test('invalid stored presentation fields fall back independently while saved pages survive', async () => {
  const browser = fakeBrowser([tab(1, 'https://keep.test/')]);
  Object.assign(browser.local.data, { theme: 'unknown', backgroundColor: 'red', showSearchBar: 0,
    pageControlsPosition: 'bottom', favoritesPerRow: 99, fontScale: 0 });
  Object.assign(browser.local.data.spaces[0], { color: '__proto__', icon: 'missing', iconColor: 'red' });
  browser.local.data.pins.push({ id: 'p', spaceId: 'personal', url: 'https://keep.test/', title: '\u00a0', icon: 'missing' });
  const before = structuredClone(browser.local.data);
  const state = await browser.run();
  assert.equal(state.spaces[0].color, 'slate');
  assert.equal(state.spaces[0].icon, 'sun');
  assert.equal(state.theme, 'system');
  assert.equal(state.backgroundColor, null);
  assert.equal(state.showSearchBar, true);
  assert.equal(state.favoritesPerRow, 4);
  assert.equal(state.fontScale, 100);
  assert.equal(state.pins[0].title, 'keep.test');
  assert.deepEqual(browser.local.data, before);
  await browser.run('SET_THEME', { theme: 'dark' });
  assert.equal(browser.local.data.spaces[0].color, 'slate');
  assert.equal(browser.local.data.pins[0].url, 'https://keep.test/');
  assert.equal((await browser.run('EXPORT_DATA')).exportDocument.spaces[0].items.length, 1);
});

test('malformed collections and orphan references recover without changing the input', () => {
  for (const value of [null, [], 'broken', { spaces: [null], folders: {}, favorites: 3 }]) {
    const data = normalizeStoredData(value);
    assert.ok(data.spaces.length > 0);
    assert.deepEqual(data.pins, []);
  }
  const source = defaultData();
  source.pins = [{ id: 'p', spaceId: 'missing', folderId: 'missing', title: 'Keep', url: 'https://keep.test/' }, null, { url: 'javascript:alert(1)' }];
  const before = structuredClone(source);
  const data = normalizeStoredData(source);
  assert.equal(data.pins.length, 1);
  assert.equal(data.pins[0].spaceId, 'personal');
  assert.equal(data.pins[0].folderId, undefined);
  assert.deepEqual(source, before);
  assert.deepEqual(normalizeStoredData(data), data);
});

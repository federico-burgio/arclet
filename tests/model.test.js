import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, safeSavedUrl, matchingTabs, openTabsForSpace } from '../src/model.js';

test('addresses, localhost and plain search terms navigate safely', () => {
  assert.equal(destination(''), 'chrome://newtab/');
  assert.equal(destination('example.com/docs'), 'https://example.com/docs');
  assert.equal(destination('localhost:3000/hello'), 'http://localhost:3000/hello');
  assert.equal(destination('ideas for a weekend'), 'https://www.google.com/search?q=ideas%20for%20a%20weekend');
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
    assert.ok(destination(url).startsWith('https://www.google.com/search?q='));
    assert.throws(() => safeSavedUrl(url));
  }
});

test('search matches every term across titles and URLs', () => {
  const tabs = [{ id: 1, title: 'Design system', url: 'https://figma.com/' }, { id: 2, title: 'Design notes', url: 'https://notion.so/' }];
  assert.deepEqual(matchingTabs(tabs, 'FIGMA design').map(tab => tab.id), [1]);
  assert.deepEqual(matchingTabs(tabs, ' '), tabs);
});

test('open-tab list hides only pages pinned in the selected space and keeps the underlying tabs', () => {
  const tabs = [
    { id: 1, url: 'https://same.test/', spaceId: 'personal' },
    { id: 2, url: 'https://other.test/', spaceId: 'personal' },
    { id: 3, url: 'https://same.test/', spaceId: 'work' },
    { id: 4, url: 'https://native.test/', spaceId: 'personal', pinned: true },
    { id: 5, pendingUrl: 'https://same.test/', spaceId: 'personal' },
    { id: 6, url: 'https://same.test/', spaceId: 'personal' }
  ];
  const pins = [{ url: 'https://same.test/', spaceId: 'personal' }, { url: 'https://other.test/', spaceId: 'work' }];
  assert.deepEqual(openTabsForSpace(tabs, pins, 'personal').map(tab => tab.id), [2, 4]);
  assert.deepEqual(openTabsForSpace(tabs, pins, 'work').map(tab => tab.id), [3]);
  assert.equal(tabs.length, 6);
});

test('favorites hide matching tabs across spaces without changing tabs or search results', () => {
  const tabs = [
    { id: 1, title: 'Favorite', url: 'https://favorite.test/', spaceId: 'personal' },
    { id: 2, title: 'Favorite copy', url: 'https://favorite.test/', spaceId: 'work' },
    { id: 3, title: 'Loading favorite', pendingUrl: 'https://favorite.test/', spaceId: 'personal' },
    { id: 4, title: 'Other page', url: 'https://other.test/', spaceId: 'personal' },
    { id: 5, title: 'Other path', url: 'https://favorite.test/other', spaceId: 'personal' }
  ];
  const before = structuredClone(tabs);
  const favorites = [{ id: 'favorite', url: 'https://favorite.test/' }];
  assert.deepEqual(openTabsForSpace(tabs, [], 'personal', favorites).map(tab => tab.id), [4, 5]);
  assert.deepEqual(openTabsForSpace(tabs, [], 'work', favorites), []);
  assert.deepEqual(matchingTabs(tabs, 'Favorite').map(tab => tab.id), [1, 2, 3, 5]);
  assert.deepEqual(tabs, before);
  // Removing the favorite restores live tabs, unless the same URL is pinned.
  assert.deepEqual(openTabsForSpace(tabs, [], 'personal', []).map(tab => tab.id), [1, 3, 4, 5]);
  const pins = [{ url: 'https://favorite.test/', spaceId: 'personal' }];
  assert.deepEqual(openTabsForSpace(tabs, pins, 'personal', []).map(tab => tab.id), [4, 5]);
});

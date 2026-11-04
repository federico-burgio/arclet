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

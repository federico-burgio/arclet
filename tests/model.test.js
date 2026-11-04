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

test('open-tab list hides owned instances away from home and keeps independent duplicates', () => {
  const tabs = [
    { id: 1, url: 'https://same.test/child', spaceId: 'personal', savedPageId: 'pin' },
    { id: 2, url: 'https://other.test/', spaceId: 'personal' },
    { id: 3, url: 'https://same.test/', spaceId: 'work' },
    { id: 4, url: 'https://native.test/', spaceId: 'personal', pinned: true },
    { id: 5, pendingUrl: 'https://same.test/', spaceId: 'personal', savedPageId: 'favorite' },
    { id: 6, url: 'https://same.test/', spaceId: 'personal' }
  ];
  const before = structuredClone(tabs);
  assert.deepEqual(openTabsForSpace(tabs, [], 'personal').map(tab => tab.id), [2, 4, 6]);
  assert.deepEqual(openTabsForSpace(tabs, [], 'work').map(tab => tab.id), [3]);
  assert.deepEqual(matchingTabs(tabs, 'same').map(tab => tab.id), [1, 3, 6]);
  assert.deepEqual(tabs, before);
});

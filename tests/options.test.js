import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canHandleMessage } from '../src/message-access.js';
import { connect } from '../src/platform.js';
import { createDemoApi } from '../src/demo.js';
import { createController } from '../src/controller.js';

const runtime = { id: 'arclet-test', getURL: path => `chrome-extension://arclet-test/${path}` };
const sender = path => ({ id: runtime.id, url: runtime.getURL(path) });

test('settings with section hashes can read and change preferences, import, and export', () => {
  for (const path of ['options.html', 'options.html#appearance', 'options.html#sidebar', 'options.html#import-export', 'options.html#about']) {
    for (const type of ['GET_STATE', 'SET_THEME', 'SET_BACKGROUND_COLOR', 'SET_FONT_SCALE', 'SET_FAVORITES_PER_ROW', 'SET_SEARCH_VISIBILITY', 'SET_PAGE_CONTROLS_POSITION', 'SET_FAVORITE_LABELS', 'PREVIEW_IMPORT', 'IMPORT_DATA', 'EXPORT_DATA']) {
      assert.equal(canHandleMessage(runtime, { type }, sender(path)), true, `${path}: ${type}`);
    }
  }
});

test('settings cannot issue tab actions or arbitrary commands and other documents remain untrusted', () => {
  for (const type of ['CLOSE_TAB', 'CLOSE_TABS', 'NEW_TAB', 'SAVE_SPACE', 'MOVE_TAB', 'DELETE_PAGE', 'STATE_CHANGED', 'UNKNOWN']) {
    assert.equal(canHandleMessage(runtime, { type }, sender('options.html#about')), false, type);
  }
  for (const source of [
    { id: 'another-extension', url: runtime.getURL('options.html') },
    { id: runtime.id, url: 'https://example.com/options.html' },
    sender('options.html?other=1'), sender('other.html'), sender('options.html/extra'),
    { id: runtime.id }, { id: runtime.id, url: 'invalid' }
  ]) assert.equal(canHandleMessage(runtime, { type: 'SET_THEME' }, source), false);
  assert.equal(canHandleMessage(runtime, { type: 'CLOSE_TAB' }, sender('sidepanel.html')), true);
  assert.equal(canHandleMessage(runtime, { type: 'STATE_CHANGED' }, sender('sidepanel.html')), false);
});

test('sidebar opens the registered native options page without creating a managed tab itself', async () => {
  const previous = globalThis.chrome;
  let opened = 0;
  const messages = [];
  globalThis.chrome = {
    windows: { getCurrent: async () => ({ id: 42 }) },
    runtime: {
      id: 'arclet-test', openOptionsPage: async () => { opened++; },
      sendMessage: async message => { messages.push(message); return { ok: true, state: { theme: 'dark' } }; }
    }
  };
  try {
    const platform = await connect();
    await platform.openOptions();
    await platform.openOptions();
    assert.equal(opened, 2);
    assert.deepEqual(await platform.request('SET_THEME', { theme: 'dark' }), { theme: 'dark' });
    assert.deepEqual(messages, [{ type: 'SET_THEME', payload: { theme: 'dark' }, windowId: 42 }]);
    globalThis.chrome.runtime.openOptionsPage = async () => { throw new Error('Extension reloaded'); };
    await assert.rejects(platform.openOptions(), /Extension reloaded/);
  } finally { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; }
});

test('separate preview pages share saved preferences while their sample browser tabs remain independent', async () => {
  let saved;
  const store = { get: () => structuredClone(saved), set: data => { saved = structuredClone(data); } };
  const sidebar = createController(createDemoApi({ savedDataStore: store }));
  const options = createController(createDemoApi({ savedDataStore: store }));
  const run = (controller, type = 'GET_STATE', payload = {}) => controller.dispatch({ type, payload, windowId: 1 });
  const before = await run(sidebar);
  await run(options, 'SET_THEME', { theme: 'dark' });
  await run(options, 'SET_FAVORITES_PER_ROW', { count: 2 });
  await run(options, 'SET_SEARCH_VISIBILITY', { visible: false });
  const after = await run(sidebar);
  assert.equal(after.theme, 'dark');
  assert.equal(after.favoritesPerRow, 2);
  assert.equal(after.showSearchBar, false);
  assert.deepEqual(after.tabs, before.tabs);
  const reopened = createController(createDemoApi({ savedDataStore: store }));
  assert.equal((await run(reopened)).theme, 'dark');
});

test('Restore requests optional sessions access before messaging and denial leaves tabs untouched', async () => {
  const previous = globalThis.chrome;
  const calls = [];
  let granted = false;
  globalThis.chrome = {
    windows: { getCurrent: async () => ({ id: 42 }) },
    permissions: { request: async value => { calls.push(value); return granted; } },
    runtime: { id: 'test', sendMessage: async message => { calls.push(message.type); return { ok: true, state: {} }; } }
  };
  try {
    const platform = await connect();
    await assert.rejects(platform.request('RESTORE_TAB'), /not allowed/);
    assert.deepEqual(calls, [{ permissions: ['sessions'] }]);
    granted = true;
    await platform.request('RESTORE_TAB');
    assert.deepEqual(calls.slice(1), [{ permissions: ['sessions'] }, 'RESTORE_TAB']);
    await platform.request('GET_STATE');
    assert.equal(calls.at(-1), 'GET_STATE');
  } finally { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; }
});

test('saved tabs can close before sessions access exists and restore works after it is granted', async () => {
  const browser = (await import('./fake-browser.js')).fakeBrowser([{ id: 1, windowId: 1, url: 'https://close.test/', title: 'Close', index: 0 }]);
  const sessions = browser.api.sessions;
  delete browser.api.sessions;
  await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  await browser.run('CLOSE_TAB', { id: 1 });
  assert.equal((await browser.run()).tabs.length, 0);
  await assert.rejects(browser.run('RESTORE_TAB'), /Allow recently closed/);
  browser.api.sessions = sessions;
  assert.equal((await browser.run('RESTORE_TAB')).tabs.length, 1);
});

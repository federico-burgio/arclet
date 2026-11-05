import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/controller.js';
import { fakeBrowser, tab } from './fake-browser.js';

test('an unresolved tab close releases the queue and its late completion cannot save stale data', async () => {
  const browser = fakeBrowser([tab(1, 'https://stay.test/')]);
  let finish;
  browser.api.tabs.remove = () => new Promise(resolve => { finish = resolve; });
  const controller = createController(browser.api, () => {}, { apiTimeoutMs: 10 });
  const close = controller.dispatch({ type: 'CLOSE_TAB', windowId: 1, payload: { id: 1 } });
  const theme = controller.dispatch({ type: 'SET_THEME', windowId: 1, payload: { theme: 'dark' } });
  await assert.rejects(close, /tabs.remove took too long/);
  assert.equal((await theme).theme, 'dark');
  const saved = structuredClone(browser.local);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(browser.local, saved);
  assert.equal((await controller.dispatch({ type: 'GET_STATE', windowId: 1 })).tabs.length, 1);
});

test('a stalled storage read also releases the queue', async () => {
  const browser = fakeBrowser();
  const get = browser.api.storage.local.get;
  browser.api.storage.local.get = () => new Promise(() => {});
  const controller = createController(browser.api, () => {}, { apiTimeoutMs: 10 });
  await assert.rejects(controller.dispatch({ type: 'GET_STATE', windowId: 1 }), /storage.local.get took too long/);
  browser.api.storage.local.get = get;
  assert.equal((await controller.dispatch({ type: 'GET_STATE', windowId: 1 })).theme, 'system');
});

// Uses a disposable Chrome profile and localhost pages; never the user's profile.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const { chromium } = process.env.ARCLET_PLAYWRIGHT
  ? await import(pathToFileURL(join(resolve(process.env.ARCLET_PLAYWRIGHT), 'index.mjs')))
  : await import('playwright');
const profile = await mkdtemp(join(tmpdir(), 'arclet-review-profile-'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>Stay test</title><button id="enable">Enable leave prompt</button><script>document.querySelector("button").onclick = () => { window.onbeforeunload = e => { e.preventDefault(); e.returnValue = ""; }; };</script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.ARCLET_CHROME ? { executablePath: process.env.ARCLET_CHROME } : { channel: 'chromium' }),
    headless: true,
    args: [`--disable-extensions-except=${resolve('.')}`, `--load-extension=${resolve('.')}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/stay`);
  await page.locator('#enable').click();
  let dialogs = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  const panel = await context.newPage();
  const errors = [];
  panel.on('pageerror', error => errors.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.bringToFront();
  await panel.waitForSelector('#copy-url:not([disabled])');
  await panel.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async text => { await write(text); globalThis.copiedUrl = text; };
  });
  await panel.locator('#copy-url').click();
  await panel.waitForFunction(() => Boolean(globalThis.copiedUrl));
  const permissions = await panel.evaluate(() => chrome.permissions.getAll());
  assert.equal(permissions.permissions.includes('clipboardWrite'), false);
  assert.equal(permissions.permissions.includes('sessions'), false);
  console.log('Copy URL succeeds without clipboardWrite; sessions is absent on fresh install.');
  const info = await worker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    return { windowId: tab.windowId, id: tab.id };
  }, page.url());
  const result = await panel.evaluate(({ windowId, id }) => chrome.runtime.sendMessage({ type: 'CLOSE_TAB', windowId, payload: { id } }), info);
  const state = await panel.evaluate(({ windowId }) => chrome.runtime.sendMessage({ type: 'GET_STATE', windowId }), info);
  assert.equal(dialogs, 1);
  assert.equal(page.isClosed(), false);
  assert.equal(state.ok, true);
  assert.ok(state.state.tabs.some(tab => tab.id === info.id));
  console.log(JSON.stringify({ beforeUnload: 'Stay preserves the tab; queue responds', closeResult: result.ok ? 'completed' : result.error }));

  await page.evaluate(() => { window.onbeforeunload = null; });
  const panelTab = await panel.evaluate(() => chrome.tabs.getCurrent());
  const command = (type, payload = {}) => panel.evaluate(message => chrome.runtime.sendMessage(message), { type, payload, windowId: info.windowId });
  assert.equal((await command('MOVE_TAB', { id: panelTab.id, spaceId: 'work' })).ok, true);
  await worker.evaluate(async id => { await chrome.tabs.update(id, { pinned: true }); }, info.id);
  // Exercise an invalid stored palette through the real extension UI.
  await worker.evaluate(async () => {
    const { data } = await chrome.storage.local.get('data');
    data.spaces[0].color = 'unknown-palette';
    await chrome.storage.local.set({ data });
  });
  await panel.reload();
  await panel.waitForSelector('#new-tab:not([disabled])');
  await panel.locator('#new-tab').click({ button: 'right' });
  await panel.getByRole('menuitem', { name: 'Close all tabs', exact: true }).click();
  await panel.locator('#bulk-close-dialog[open]').waitFor();
  assert.match(await panel.locator('#bulk-close-description').textContent(), /1 Chrome-pinned tab/);
  await panel.locator('#bulk-close-dialog button[value="cancel"]').click();
  assert.equal(page.isClosed(), false);
  await panel.locator('#new-tab').click({ button: 'right' });
  await panel.getByRole('menuitem', { name: 'Close all tabs', exact: true }).click();
  await panel.locator('#bulk-close-dialog[open]').waitFor();
  const arrival = await worker.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: false }));
  const closed = page.waitForEvent('close');
  await panel.locator('#bulk-close-dialog button[value="confirm"]').click();
  await closed;
  assert.ok(await worker.evaluate(async id => Boolean(await chrome.tabs.get(id)), arrival.id));
  assert.equal(panel.isClosed(), false);
  assert.deepEqual(errors, []);
  console.log('Bulk close warns about Chrome pins; Cancel is safe; confirmation leaves new tabs open. Invalid stored palette renders without page errors.');
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

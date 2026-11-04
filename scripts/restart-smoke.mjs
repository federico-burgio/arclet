// Uses real, separate Chrome processes and the same temporary profile for both.
// All web pages are served on localhost; the user's Chrome profile is never used.
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const { chromium } = process.env.ARCLET_PLAYWRIGHT
  ? await import(pathToFileURL(join(resolve(process.env.ARCLET_PLAYWRIGHT), 'index.mjs')))
  : await import('playwright');
const profile = await mkdtemp(join(tmpdir(), 'arclet-restart-'));
await mkdir(join(profile, 'Default'));
await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ session: { restore_on_startup: 1 } }));
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><title>${request.url.slice(1)}</title><h1>Arclet restart test</h1>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let panel;
const launch = async (restore = false) => {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.ARCLET_CHROME ? { executablePath: process.env.ARCLET_CHROME } : { channel: 'chromium' }),
    headless: true,
    args: [`--disable-extensions-except=${resolve('.')}`, `--load-extension=${resolve('.')}`, ...(restore ? ['--restore-last-session'] : [])]
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  return worker;
};
const command = async (windowId, type, payload = {}) => {
  const result = await panel.evaluate(message => chrome.runtime.sendMessage(message), { windowId, type, payload });
  assert.equal(result.ok, true, result.error);
  return result.state;
};
const readWorkspace = worker => worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
const poll = async (check, description) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
};

try {
  let worker = await launch();
  const extensionId = new URL(worker.url()).host;
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.waitForFunction(() => document.querySelector('#space-name').textContent === 'Personal');
  const windows = await worker.evaluate(async origin => {
    const a = await chrome.windows.create({ url: [`${origin}/common`, `${origin}/a`, `${origin}/common`] });
    const b = await chrome.windows.create({ url: [`${origin}/common`, `${origin}/b-old`] });
    return { a: a.id, b: b.id };
  }, origin);
  await poll(async () => {
    const state = await command(windows.a, 'GET_STATE');
    return state.tabs.filter(tab => tab.url?.startsWith(origin)).length === 3;
  }, 'initial tabs load');
  const a = await command(windows.a, 'GET_STATE');
  const b = await command(windows.b, 'GET_STATE');
  await command(windows.a, 'MOVE_TAB', { id: a.tabs[0].id, spaceId: 'work' });
  await command(windows.b, 'MOVE_TAB', { id: b.tabs[1].id, spaceId: 'work' });
  // Change a URL through Chrome itself, not a sidebar command, then wait for the
  // background event to checkpoint it with the sidebar closed in that window.
  await worker.evaluate(async ({ id, url }) => { await chrome.tabs.update(id, { url }); }, { id: b.tabs[1].id, url: `${origin}/b` });
  await poll(async () => (await readWorkspace(worker)).windows.some(window => window.tabs.some(tab => tab.url === `${origin}/b` && tab.spaceId === 'work')), 'native navigation checkpoint');
  await command(windows.a, 'SELECT_SPACE', { id: 'work' });
  await command(windows.b, 'SELECT_SPACE', { id: 'personal' });
  const before = await readWorkspace(worker);
  assert.equal(before.windows.filter(window => window.tabs.some(tab => tab.url?.startsWith(origin))).length, 2);
  console.log('PASS: Live assignments, duplicate URLs, and multiple windows checkpointed.');

  await context.close();
  context = null;
  worker = await launch(true);
  await poll(async () => {
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    return tabs.filter(tab => tab.url?.startsWith(origin)).length === 5;
  }, 'Chrome restores all five web tabs');
  const restored = await worker.evaluate(() => chrome.tabs.query({}));
  const restoredA = restored.find(tab => tab.url === `${origin}/a`).windowId;
  const restoredB = restored.find(tab => tab.url === `${origin}/b`).windowId;
  assert.notEqual(restoredA, restoredB);
  panel = context.pages().find(page => page.url() === `chrome-extension://${extensionId}/sidepanel.html`);
  if (!panel) { panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`); }
  const afterA = await command(restoredA, 'GET_STATE');
  const afterB = await command(restoredB, 'GET_STATE');
  assert.deepEqual(afterA.tabs.filter(tab => tab.url.startsWith(origin)).map(tab => [new URL(tab.url).pathname, tab.spaceId]), [
    ['/common', 'work'], ['/a', 'personal'], ['/common', 'personal']
  ]);
  assert.deepEqual(afterB.tabs.filter(tab => tab.url.startsWith(origin)).map(tab => [new URL(tab.url).pathname, tab.spaceId]), [
    ['/common', 'personal'], ['/b', 'work']
  ]);
  console.log('PASS: A full Chrome process restart recovers each tab into its original space.');
  // Reopening/reloading the panel must preserve the just-recovered assignments.
  await panel.reload();
  await panel.waitForFunction(() => document.querySelector('#space-name').textContent !== 'Your space');
  assert.deepEqual((await command(restoredA, 'GET_STATE')).tabs.map(tab => tab.spaceId), afterA.tabs.map(tab => tab.spaceId));
  console.log('PASS: Reopening the panel preserves recovered state.');
} catch (error) {
  if (context) {
    const [worker] = context.serviceWorkers();
    if (worker) console.error('Checkpoint at failure:', JSON.stringify(await readWorkspace(worker), null, 2));
  }
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { pinnedEntries } from '../src/pinned-order.js';
import { folderDropPosition } from '../src/pin-drag.js';

const order = (state, folderId = null, spaceId = 'personal') => pinnedEntries(state, spaceId, folderId).map(({ item }) => item.id);
async function fixture() {
  const browser = fakeBrowser(['a', 'b', 'c', 'd'].map((name, index) => tab(index + 1, `https://${name}.test/`, index)));
  for (const tabId of [1, 2, 3]) await browser.run('SAVE_PAGE', { kind: 'pin', tabId });
  await browser.run('SAVE_FOLDER', { name: 'First', icon: 'folder' });
  const state = await browser.run('SAVE_FOLDER', { name: 'Second', icon: 'folder', iconColor: '#477fc1' });
  return { browser, pins: state.pins, folders: state.folders };
}

test('reorders pins and folders in one mixed root list, in both directions', async () => {
  const { browser, pins: [a, b, c], folders: [first, second] } = await fixture();
  let state = await browser.run('MOVE_PINNED', { kind: 'folder', id: first.id, targetKind: 'pin', targetId: b.id, placement: 'before' });
  assert.deepEqual(order(state), [a.id, first.id, b.id, c.id, second.id]);
  state = await browser.run('MOVE_PINNED', { kind: 'pin', id: a.id, targetKind: 'folder', targetId: second.id, placement: 'after' });
  assert.deepEqual(order(state), [first.id, b.id, c.id, second.id, a.id]);
  state = await browser.run('MOVE_PINNED', { kind: 'folder', id: second.id, targetKind: 'folder', targetId: first.id });
  assert.deepEqual(order(state), [second.id, first.id, b.id, c.id, a.id]);
  state = await browser.run('MOVE_PINNED', { kind: 'pin', id: c.id, targetKind: 'pin', targetId: b.id });
  assert.deepEqual(order(state), [second.id, first.id, c.id, b.id, a.id]);
  assert.equal(state.tabs.length, 4);
});

test('moves pins into, between, and out of folders at exact positions', async () => {
  const { browser, pins: [a, b, c], folders: [first, second] } = await fixture();
  await browser.run('MOVE_PINNED', { kind: 'pin', id: a.id, folderId: first.id });
  await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: first.id });
  let state = await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: first.id, targetId: a.id, targetKind: 'pin' });
  assert.deepEqual(order(state, first.id), [b.id, a.id]);
  await browser.run('TOGGLE_FOLDER', { id: second.id });
  state = await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: second.id });
  assert.deepEqual(order(state, first.id), [a.id]);
  assert.deepEqual(order(state, second.id), [b.id]);
  assert.equal(state.folders.find(folder => folder.id === second.id).collapsed, false);
  state = await browser.run('MOVE_PINNED', { kind: 'pin', id: a.id, targetKind: 'folder', targetId: second.id, placement: 'before' });
  assert.deepEqual(order(state), [c.id, first.id, a.id, second.id]);
  assert.equal(state.pins.find(pin => pin.id === a.id).folderId, undefined);
  assert.deepEqual(order(state, first.id), []);
  assert.equal(state.pins.length, 3);
});

test('moving a folder preserves its children, icons, and collapsed state', async () => {
  const { browser, pins: [a, b], folders: [first, second] } = await fixture();
  await browser.run('MOVE_PINNED', { kind: 'pin', id: a.id, folderId: second.id });
  await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: second.id });
  await browser.run('TOGGLE_FOLDER', { id: second.id });
  const state = await browser.run('MOVE_PINNED', { kind: 'folder', id: second.id, targetKind: 'folder', targetId: first.id });
  assert.deepEqual(order(state, second.id), [a.id, b.id]);
  assert.equal(state.folders.find(folder => folder.id === second.id).collapsed, true);
  assert.equal(state.folders.find(folder => folder.id === second.id).iconColor, '#477fc1');
});

test('order and folder membership survive worker suspension and a full restart', async () => {
  const { browser, pins: [a, b, c], folders: [first, second] } = await fixture();
  await browser.run('MOVE_PINNED', { kind: 'folder', id: first.id, targetId: a.id, targetKind: 'pin' });
  await browser.run('MOVE_PINNED', { kind: 'pin', id: c.id, folderId: second.id });
  await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: second.id, targetId: c.id, targetKind: 'pin' });
  const expected = await browser.run();
  browser.suspend();
  assert.deepEqual(order(await browser.run()), order(expected));
  browser.restart(['a', 'b', 'c', 'd'].map((name, index) => tab(100 + index, `https://${name}.test/`, index)));
  const state = await browser.run();
  assert.deepEqual(order(state), order(expected));
  assert.deepEqual(order(state, second.id), [b.id, c.id]);
  assert.equal(state.tabs.length, 4);
});

test('stale targets, cross-space moves, and folder nesting fail without changing saved data', async () => {
  const { browser, pins: [a, b], folders: [first] } = await fixture();
  let state = await browser.run('SAVE_FOLDER', { name: 'Other space', icon: 'folder', spaceId: 'work' });
  const foreign = state.folders.at(-1);
  await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: first.id });
  const before = structuredClone(browser.local.data);
  for (const payload of [
    { kind: 'pin', id: a.id, folderId: foreign.id },
    { kind: 'folder', id: first.id, folderId: first.id },
    { kind: 'pin', id: a.id, targetId: foreign.id, targetKind: 'folder' },
    { kind: 'pin', id: a.id, targetId: b.id, targetKind: 'pin' },
    { kind: 'pin', id: a.id, targetId: 'deleted', targetKind: 'pin' },
    { kind: 'pin', id: a.id, targetId: first.id, targetKind: 'pin' },
    { kind: 'pin', id: a.id, placement: 'inside' },
    { kind: 'missing', id: a.id },
    { kind: 'folder', id: 'deleted' }
  ]) {
    await assert.rejects(browser.run('MOVE_PINNED', payload));
    assert.deepEqual(browser.local.data, before);
  }
  state = await browser.run('MOVE_PINNED', { kind: 'pin', id: a.id, targetId: a.id, targetKind: 'pin' });
  assert.deepEqual(state.pins, before.pins);
});

test('migration preserves old root and child display order; new items append', async () => {
  const { browser, pins: [a, b, c], folders: [first, second] } = await fixture();
  browser.local.data.pins[1].folderId = first.id;
  browser.local.data.pins[2].folderId = first.id;
  for (const item of [...browser.local.data.pins, ...browser.local.data.folders]) delete item.order;
  browser.suspend();
  let state = await browser.run();
  assert.deepEqual(order(state), [a.id, first.id, second.id]);
  assert.deepEqual(order(state, first.id), [b.id, c.id]);
  state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 4 });
  assert.deepEqual(order(state), [a.id, first.id, second.id, state.pins.at(-1).id]);
});

test('removing an ordered folder keeps its children in the folder’s former position', async () => {
  const { browser, pins: [a, b, c], folders: [first, second] } = await fixture();
  await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: first.id });
  await browser.run('MOVE_PINNED', { kind: 'pin', id: c.id, folderId: first.id });
  await browser.run('MOVE_PINNED', { kind: 'folder', id: first.id, targetKind: 'pin', targetId: a.id });
  const state = await browser.run('DELETE_FOLDER', { id: first.id });
  assert.deepEqual(order(state), [b.id, c.id, a.id, second.id]);
  assert.equal(state.pins.length, 3);
});

test('deleting a space appends its mixed root order while preserving child order', async () => {
  const { browser, pins: [a, b, c], folders: [first, second] } = await fixture();
  await browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: first.id });
  await browser.run('MOVE_PINNED', { kind: 'folder', id: first.id, targetKind: 'pin', targetId: a.id });
  await browser.run('SAVE_FOLDER', { name: 'Work folder', icon: 'folder', spaceId: 'work' });
  const before = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 4, spaceId: 'work' });
  const workOrder = order(before, null, 'work');
  const state = await browser.run('DELETE_SPACE', { id: 'personal' });
  assert.deepEqual(order(state, null, 'work'), [...workOrder, first.id, a.id, c.id, second.id]);
  assert.deepEqual(order(state, first.id, 'work'), [b.id]);
});

test('pinning a live tab at a drop anchor is atomic and does not reorder Chrome tabs', async () => {
  const { browser, pins: [a], folders: [first] } = await fixture();
  const before = await browser.run();
  await assert.rejects(browser.run('SAVE_PAGE', { kind: 'pin', tabId: 4, folderId: first.id, targetKind: 'pin', targetId: a.id }));
  assert.deepEqual((await browser.run()).pins, before.pins);
  const state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 4, targetKind: 'folder', targetId: first.id });
  const newPin = state.pins.at(-1);
  const root = order(state);
  assert.equal(root[root.indexOf(first.id) - 1], newPin.id);
  assert.deepEqual(state.tabs, before.tabs);
});

test('serialized stale-panel moves preserve all pins without overwriting sibling order', async () => {
  const { browser, pins: [a, b, c], folders: [first] } = await fixture();
  await Promise.all([
    browser.run('MOVE_PINNED', { kind: 'pin', id: a.id, folderId: first.id }),
    browser.run('MOVE_PINNED', { kind: 'pin', id: b.id, folderId: first.id }),
    browser.run('MOVE_PINNED', { kind: 'pin', id: c.id, folderId: first.id })
  ]);
  const state = await browser.run();
  assert.deepEqual(order(state, first.id), [a.id, b.id, c.id]);
  assert.equal(new Set(state.pins.map(pin => pin.id)).size, 3);
});

test('folder drop edges reorder while the center files pins; folders never nest', () => {
  assert.equal(folderDropPosition('pin', 102, 100, 40), 'before');
  assert.equal(folderDropPosition('pin', 120, 100, 40), 'inside');
  assert.equal(folderDropPosition('pin', 138, 100, 40), 'after');
  assert.equal(folderDropPosition('folder', 119, 100, 40), 'before');
  assert.equal(folderDropPosition('folder', 121, 100, 40), 'after');
});

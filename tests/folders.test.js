import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, tab } from './fake-browser.js';
import { openTabsForSpace } from '../src/model.js';

const folderDraft = { name: 'Inspiration', icon: 'palette', iconColor: '#8b68c0' };

test('older saved data upgrades without changing pins, spaces, or favorites', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  delete browser.local.data.folders;
  const before = structuredClone(browser.local.data);
  browser.suspend();
  const state = await browser.run();
  assert.deepEqual(state.folders, []);
  for (const key of ['pins', 'spaces', 'favorites']) assert.deepEqual(state[key], before[key]);
});

test('folder membership, custom icons, and collapse state survive a Chrome restart', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  let state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  const pin = state.pins[0];
  state = await browser.run('SAVE_FOLDER', { ...folderDraft, pageId: pin.id });
  const folder = state.folders[0];
  assert.equal(state.pins[0].folderId, folder.id);
  await browser.run('TOGGLE_FOLDER', { id: folder.id });
  browser.restart([tab(200, 'https://a.test/')]);
  state = await browser.run();
  assert.deepEqual(state.folders[0], { ...folder, collapsed: true });
  assert.equal(state.pins[0].folderId, folder.id);
  assert.equal(openTabsForSpace(state.tabs, state.pins, 'personal').length, 0);
  // Opening a saved pin in a collapsed folder still reuses its restored live tab.
  state = await browser.run('OPEN_PAGE', { id: pin.id });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, 200);
});

test('pins can be filed, moved, and unfiled; invalid cross-space moves are atomic', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  let state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  const pin = state.pins[0];
  state = await browser.run('SAVE_FOLDER', folderDraft);
  const first = state.folders[0];
  state = await browser.run('SAVE_FOLDER', { ...folderDraft, name: 'Reading', icon: 'book-open' });
  const second = state.folders[1];
  await browser.run('MOVE_PIN', { id: pin.id, folderId: first.id });
  await browser.run('TOGGLE_FOLDER', { id: second.id });
  state = await browser.run('MOVE_PIN', { id: pin.id, folderId: second.id });
  assert.equal(state.pins[0].folderId, second.id);
  assert.equal(state.folders[1].collapsed, false);
  state = await browser.run('SAVE_FOLDER', { ...folderDraft, spaceId: 'work' });
  const otherSpace = state.folders[2];
  await assert.rejects(browser.run('MOVE_PIN', { id: pin.id, folderId: otherSpace.id }), /same space/);
  await assert.rejects(browser.run('MOVE_PIN', { id: pin.id, folderId: 'missing' }), /same space/);
  assert.equal((await browser.run()).pins[0].folderId, second.id);
  state = await browser.run('MOVE_PIN', { id: pin.id, folderId: null });
  assert.equal(state.pins[0].folderId, undefined);
});

test('pinning directly into a folder validates its space and keeps browser tabs open', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  let state = await browser.run('SAVE_FOLDER', { ...folderDraft, spaceId: 'work' });
  const folder = state.folders[0];
  await assert.rejects(browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1, folderId: folder.id }), /same space/);
  assert.equal((await browser.run()).pins.length, 0);
  state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1, spaceId: 'work', folderId: folder.id });
  assert.equal(state.pins[0].folderId, folder.id);
  assert.equal(state.tabs.length, 1);
  await assert.rejects(browser.run('SAVE_FOLDER', { ...folderDraft, pageId: state.pins[0].id, spaceId: 'personal' }), /in this space/);
  assert.equal((await browser.run()).folders.length, 1);
});

test('editing and removing folders preserves their pinned pages and live tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  let state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  const pin = state.pins[0];
  state = await browser.run('SAVE_FOLDER', { ...folderDraft, pageId: pin.id });
  const folder = state.folders[0];
  state = await browser.run('SAVE_FOLDER', { id: folder.id, name: 'Reference', icon: 'library', iconColor: '#477FC1' });
  assert.equal(state.folders.length, 1);
  assert.equal(state.folders[0].iconColor, '#477fc1');
  assert.equal(state.folders[0].name, 'Reference');
  state = await browser.run('DELETE_FOLDER', { id: folder.id });
  assert.deepEqual(state.folders, []);
  assert.deepEqual(state.pins, [pin]);
  assert.equal(state.tabs.length, 1);
  await assert.rejects(browser.run('TOGGLE_FOLDER', { id: folder.id }), /no longer exists/);
  await assert.rejects(browser.run('SAVE_FOLDER', { ...folderDraft, id: folder.id }), /no longer exists/);
});

test('deleting a space moves folders and pins together, including after restart', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await browser.run('SELECT_SPACE', { id: 'work' });
  let state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  state = await browser.run('SAVE_FOLDER', { ...folderDraft, pageId: state.pins[0].id });
  const id = state.folders[0].id;
  await browser.run('DELETE_SPACE', { id: 'work' });
  browser.restart([tab(200, 'https://a.test/')]);
  state = await browser.run();
  assert.equal(state.folders[0].spaceId, 'personal');
  assert.equal(state.pins[0].spaceId, 'personal');
  assert.equal(state.pins[0].folderId, id);
});

test('custom page and space icons persist independently, with a favicon reset', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  let state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  const pin = state.pins[0];
  await browser.run('SET_PAGE_ICON', { kind: 'pin', id: pin.id, icon: 'rocket', iconColor: '#C35E5E' });
  state = await browser.run('SAVE_PAGE', { kind: 'favorite', pageId: pin.id });
  const favorite = state.favorites[0];
  assert.equal(favorite.icon, 'rocket');
  await browser.run('SET_PAGE_ICON', { kind: 'favorite', id: favorite.id, icon: 'heart', iconColor: '#bb5e82' });
  await browser.run('SAVE_SPACE', { id: 'personal', name: 'Personal', color: 'slate', icon: 'flask-conical', iconColor: '#278a8b' });
  browser.restart([tab(200, 'https://a.test/')]);
  state = await browser.run();
  assert.equal(state.spaces[0].icon, 'flask-conical');
  assert.equal(state.spaces[0].iconColor, '#278a8b');
  assert.equal(state.pins[0].icon, 'rocket');
  assert.equal(state.pins[0].iconColor, '#c35e5e');
  assert.equal(state.favorites[0].icon, 'heart');
  state = await browser.run('SET_PAGE_ICON', { kind: 'favorite', id: favorite.id, icon: null });
  assert.equal(state.favorites[0].icon, null);
  assert.equal(state.favorites[0].iconColor, null);
  assert.equal(state.pins[0].icon, 'rocket');
});

test('unknown icons and invalid colors cannot enter saved data', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  const state = await browser.run('SAVE_PAGE', { kind: 'pin', tabId: 1 });
  for (const appearance of [{ icon: 'nonexistent-icon' }, { icon: 'toString' }, { icon: '<svg onload=alert(1)>' },
    { icon: 'folder', iconColor: 'url(https://a.test)' }, { icon: 'folder', iconColor: '#fff' }]) {
    await assert.rejects(browser.run('SAVE_FOLDER', { ...folderDraft, ...appearance }), /icon|color/);
    await assert.rejects(browser.run('SET_PAGE_ICON', { kind: 'pin', id: state.pins[0].id, ...appearance }), /icon|color/);
  }
  assert.deepEqual((await browser.run()).folders, []);
  assert.equal((await browser.run()).pins[0].icon, undefined);
});

test('bulk collapse and expand persist and affect only the requested space', async () => {
  const browser = fakeBrowser();
  await browser.run('SAVE_FOLDER', { ...folderDraft, name: 'One', spaceId: 'personal' });
  await browser.run('SAVE_FOLDER', { ...folderDraft, name: 'Two', spaceId: 'personal' });
  await browser.run('SAVE_FOLDER', { ...folderDraft, name: 'Work', spaceId: 'work' });
  let state = await browser.run('SET_FOLDERS_COLLAPSED', { collapsed: true });
  assert.equal(state.folders.filter(folder => folder.spaceId === 'personal').every(folder => folder.collapsed), true);
  assert.equal(state.folders.find(folder => folder.spaceId === 'work').collapsed, false);
  const before = structuredClone(browser.local.data);
  await assert.rejects(browser.run('SET_FOLDERS_COLLAPSED', { collapsed: 'yes' }));
  await assert.rejects(browser.run('SET_FOLDERS_COLLAPSED', { spaceId: 'missing', collapsed: true }));
  assert.deepEqual(browser.local.data, before);
  browser.suspend();
  assert.equal((await browser.run()).folders.filter(folder => folder.spaceId === 'personal').every(folder => folder.collapsed), true);
  state = await browser.run('SET_FOLDERS_COLLAPSED', { spaceId: 'personal', collapsed: false });
  assert.equal(state.folders.every(folder => !folder.collapsed), true);
  await browser.run('SET_FOLDERS_COLLAPSED', { spaceId: 'work', collapsed: true });
  state = await browser.run('SET_FOLDERS_COLLAPSED', { collapsed: false });
  assert.equal(state.folders.find(folder => folder.spaceId === 'work').collapsed, true);
});

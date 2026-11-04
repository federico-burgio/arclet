// Pins and folders share one ordered root list in each space. Folder children
// have their own order. Missing positions preserve the pre-0.4 visual order.
export function pinnedEntries(data, spaceId, folderId = null) {
  const folders = data.folders ?? [];
  const folderIds = new Set(folders.filter(folder => folder.spaceId === spaceId).map(folder => folder.id));
  const entries = data.pins.filter(pin => pin.spaceId === spaceId &&
    (folderId ? pin.folderId === folderId : !folderIds.has(pin.folderId)))
    .map(item => ({ kind: 'pin', item }));
  if (!folderId) entries.push(...folders.filter(folder => folder.spaceId === spaceId).map(item => ({ kind: 'folder', item })));
  return entries.sort((a, b) => (Number.isFinite(a.item.order) ? a.item.order : Infinity) -
    (Number.isFinite(b.item.order) ? b.item.order : Infinity));
}

const numberEntries = entries => entries.forEach(({ item }, index) => { item.order = index; });

export function normalizePinnedOrder(data) {
  for (const space of data.spaces) {
    numberEntries(pinnedEntries(data, space.id));
    for (const folder of data.folders.filter(folder => folder.spaceId === space.id)) {
      numberEntries(pinnedEntries(data, space.id, folder.id));
    }
  }
}

// Validate the entire drop before changing membership or order. Anchor IDs are
// resolved against current worker state, so a stale panel cannot lose siblings.
export function movePinnedItem(data, { kind, id, folderId = null, targetId, targetKind, placement = 'before' }) {
  if (!['pin', 'folder'].includes(kind)) throw new Error('Choose a pinned page or folder.');
  const list = kind === 'pin' ? data.pins : data.folders;
  const item = list.find(item => item.id === id);
  if (!item) throw new Error('This pinned item no longer exists.');
  if (!['before', 'after'].includes(placement)) throw new Error('Choose a valid drop position.');
  if (kind === 'folder' && folderId !== null) throw new Error('Folders cannot be placed inside other folders.');
  const folder = folderId === null ? null : data.folders.find(folder => folder.id === folderId && folder.spaceId === item.spaceId);
  if (folderId !== null && !folder) throw new Error('Choose a folder in the same space.');
  const sourceFolder = kind === 'pin' ? item.folderId ?? null : null;
  const source = pinnedEntries(data, item.spaceId, sourceFolder);
  const destination = pinnedEntries(data, item.spaceId, folderId);
  const isSelf = entry => entry.kind === kind && entry.item.id === id;
  let index = destination.length;
  if (targetId != null) {
    if (!['pin', 'folder'].includes(targetKind)) throw new Error('Choose a valid drop target.');
    const targetIndex = destination.findIndex(entry => entry.kind === targetKind && entry.item.id === targetId);
    if (targetIndex < 0) throw new Error('This drop target is no longer in that location.');
    if (kind === targetKind && id === targetId) return;
    index = targetIndex + (placement === 'after' ? 1 : 0);
    const previousIndex = destination.findIndex(isSelf);
    if (previousIndex >= 0 && previousIndex < index) index--;
  } else if (destination.some(isSelf)) index--;
  const remaining = destination.filter(entry => !isSelf(entry));
  remaining.splice(index, 0, { kind, item });
  if (kind === 'pin') {
    if (folder) item.folderId = folder.id;
    else delete item.folderId;
  }
  if (sourceFolder !== folderId) numberEntries(source.filter(entry => !isSelf(entry)));
  numberEntries(remaining);
  if (folder) folder.collapsed = false;
}

export function removePinnedFolder(data, id) {
  const folder = data.folders.find(folder => folder.id === id);
  if (!folder) throw new Error('This folder no longer exists.');
  const root = pinnedEntries(data, folder.spaceId);
  const children = pinnedEntries(data, folder.spaceId, id);
  const index = root.findIndex(entry => entry.kind === 'folder' && entry.item.id === id);
  children.forEach(({ item }) => { delete item.folderId; });
  root.splice(index, 1, ...children);
  data.folders = data.folders.filter(folder => folder.id !== id);
  numberEntries(root);
}

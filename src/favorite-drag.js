import { createSavedItemDrag } from './pin-drag.js';

// Choose the nearest tile, including gaps and wrapped rows, then insert on
// its left or right. Array order stays the same as the grid's reading order.
export function favoriteDropTarget(tiles, sourceId, x, y) {
  let nearest;
  let distance = Infinity;
  for (const tile of tiles) {
    const dx = Math.max(tile.left - x, 0, x - tile.left - tile.width);
    const dy = Math.max(tile.top - y, 0, y - tile.top - tile.height);
    const next = dx * dx + dy * dy;
    if (next < distance) { distance = next; nearest = tile; }
  }
  if (!nearest || nearest.id === sourceId) return null;
  return { targetId: nearest.id, placement: x < nearest.left + nearest.width / 2 ? 'before' : 'after' };
}

export function createFavoriteDrag({ root, scroll, onStart, onEnd, onDrop }) {
  return createSavedItemDrag({
    root, scroll, onStart, onEnd, onDrop,
    sourceSelector: '[data-favorite-id]',
    sourceFor: node => ({ kind: 'favorite', id: node.dataset.favoriteId }),
    dragClass: 'favorites-dragging',
    ghostClass: 'favorite favorite-drag-ghost',
    resolveDrop(source, x, y) {
      const node = document.elementFromPoint(x, y);
      if (!node || !root.contains(node)) return null;
      const bounds = root.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
      const tiles = [...root.querySelectorAll('[data-favorite-id]')].map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.dataset.favoriteId, left: rect.left, top: rect.top, width: rect.width, height: rect.height, node };
      });
      const drop = favoriteDropTarget(tiles, source.id, x, y);
      if (!drop) return null;
      return { ...drop, position: drop.placement, axis: 'horizontal', element: tiles.find(tile => tile.id === drop.targetId).node };
    }
  });
}

// Folder headings have two edge zones for ordering and a center zone for filing.
// Kept separate from DOM interaction so the drop rules can be tested directly.
export function folderDropPosition(kind, y, top, height) {
  const fraction = (y - top) / height;
  if (kind !== 'folder' && fraction >= .25 && fraction <= .75) return 'inside';
  return fraction < .5 ? 'before' : 'after';
}

export function createPinnedDrag({ root, scroll, onStart, onEnd, onDrop }) {
  let pending;
  let active;
  let ghost;
  let indicator;
  let target;
  let frame;
  let suppressClickUntil = 0;
  let cancelledPointerId = null;

  function hit(source, x, y) {
    const node = document.elementFromPoint(x, y);
    if (!node || !root.contains(node)) return null;
    let entry = node.closest('[data-pin-kind]');
    const folderArea = node.closest('.pin-folder');
    if (!entry && folderArea) {
      entry = folderArea.querySelector('.folder-heading');
      if (source.kind !== 'folder') {
        return { folderId: entry.dataset.pinId, label: `Move into ${entry.dataset.pinLabel}`, element: entry, position: 'inside' };
      }
    }
    if (!entry) {
      if (!node.closest('[data-pin-root-drop]')) return null;
      return { folderId: null, label: 'Move outside folders', element: node.closest('[data-pin-root-drop]'), position: 'inside' };
    }
    // Folders remain at the root; pointing at one of its children orders the
    // whole folder instead of nesting a folder under a page.
    const container = source.kind === 'folder' ? entry.closest('.pin-folder') : null;
    const row = container?.querySelector('.folder-heading') ?? entry;
    const kind = row.dataset.pinKind;
    const id = row.dataset.pinId;
    if (kind === source.kind && id === source.id) return null;
    const rect = row.getBoundingClientRect();
    const position = kind === 'folder' ? folderDropPosition(source.kind, y, rect.top, rect.height)
      : y < rect.top + rect.height / 2 ? 'before' : 'after';
    if (position === 'inside') {
      return { folderId: id, label: `Move into ${row.dataset.pinLabel}`, element: row, position };
    }
    return { folderId: kind === 'folder' ? null : row.dataset.pinFolder || null,
      targetId: id, targetKind: kind, placement: position, label: `Move ${position} ${row.dataset.pinLabel}`,
      element: kind === 'folder' ? row.closest('.pin-folder') : row, position };
  }

  function clearTarget() {
    root.querySelectorAll('.pin-drop-inside').forEach(node => node.classList.remove('pin-drop-inside'));
    indicator?.remove();
    indicator = null;
  }

  function showTarget(next) {
    clearTarget();
    target = next;
    if (!next) return;
    if (next.position === 'inside') next.element.classList.add('pin-drop-inside');
    else {
      const rect = next.element.getBoundingClientRect();
      indicator = document.createElement('div');
      indicator.className = 'pin-drop-line';
      indicator.style.left = `${rect.left}px`;
      indicator.style.top = `${next.position === 'before' ? rect.top : rect.bottom}px`;
      indicator.style.width = `${rect.width}px`;
      document.body.append(indicator);
    }
    root.dataset.dropHint = next.label;
  }

  function track(x, y) {
    active.x = x;
    active.y = y;
    ghost.style.left = `${Math.max(4, Math.min(innerWidth - ghost.offsetWidth - 4, x - active.offsetX))}px`;
    ghost.style.top = `${y - active.offsetY}px`;
    showTarget(hit(active.source, x, y));
  }

  function autoScroll() {
    if (!active) return;
    const rect = scroll.getBoundingClientRect();
    const y = active.y;
    const delta = y < rect.top + 35 ? -Math.min(12, (rect.top + 35 - y) / 3)
      : y > rect.bottom - 35 ? Math.min(12, (y - rect.bottom + 35) / 3) : 0;
    if (delta && active.x >= rect.left && active.x <= rect.right) {
      scroll.scrollTop += delta;
      showTarget(hit(active.source, active.x, y));
    }
    frame = requestAnimationFrame(autoScroll);
  }

  function finish(commit = false) {
    const drag = active;
    const drop = target;
    pending = null;
    active = null;
    target = null;
    cancelAnimationFrame(frame);
    clearTarget();
    ghost?.remove();
    ghost = null;
    delete root.dataset.dropHint;
    document.body.classList.remove('pinned-dragging');
    if (!drag) return;
    drag.node.classList.remove('dragging');
    if (root.hasPointerCapture(drag.pointerId)) root.releasePointerCapture(drag.pointerId);
    suppressClickUntil = performance.now() + 300;
    // State updates are deferred while dragging, keeping the hit targets stable.
    onEnd();
    if (commit && drop) {
      const { folderId, targetId, targetKind, placement } = drop;
      onDrop({ ...drag.source, folderId, targetId, targetKind, placement });
    }
  }

  root.addEventListener('pointerdown', event => {
    cancelledPointerId = null;
    if (event.button !== 0 || !event.isPrimary || event.target.closest('.tab-action')) return;
    const node = event.target.closest('[data-pin-kind]');
    if (!node || !root.contains(node)) return;
    pending = { node, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  });
  // Native HTML dragging can take over pointer events on images/text/buttons.
  // Pins and folders use one pointer gesture across their entire row instead.
  root.addEventListener('dragstart', event => { if (event.target.closest('[data-pin-kind]')) event.preventDefault(); });
  document.addEventListener('pointermove', event => {
    if (!pending || event.pointerId !== pending.pointerId) return;
    if (!active) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
      const rect = pending.node.getBoundingClientRect();
      active = { ...pending, offsetX: pending.x - rect.left, offsetY: pending.y - rect.top,
        source: { kind: pending.node.dataset.pinKind, id: pending.node.dataset.pinId } };
      root.setPointerCapture(event.pointerId);
      ghost = pending.node.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      ghost.className = 'pinned-drag-ghost';
      ghost.style.width = `${rect.width}px`;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      document.body.append(ghost);
      pending.node.classList.add('dragging');
      document.body.classList.add('pinned-dragging');
      onStart();
      frame = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    track(event.clientX, event.clientY);
  }, { passive: false });
  document.addEventListener('pointerup', event => {
    if (event.pointerId === cancelledPointerId) {
      suppressClickUntil = performance.now() + 300;
      cancelledPointerId = null;
    }
    if (!pending || event.pointerId !== pending.pointerId) return;
    if (active) { event.preventDefault(); track(event.clientX, event.clientY); }
    finish(true);
  });
  document.addEventListener('pointercancel', () => finish());
  root.addEventListener('lostpointercapture', () => { if (active) finish(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelledPointerId = active.pointerId;
      finish();
    }
  }, true);
  document.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', () => finish());

  // Existing Chrome tab drags can also be pinned into a folder or inserted
  // between saved items using the same hit rules and indicator.
  return {
    nativeOver(source, event) {
      const next = hit(source, event.clientX, event.clientY);
      if (!next) { clearTarget(); target = null; return false; }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      showTarget(next);
      return true;
    },
    nativeDrop(source, event) {
      const next = hit(source, event.clientX, event.clientY);
      clearTarget();
      target = null;
      delete root.dataset.dropHint;
      if (!next) return null;
      event.preventDefault();
      const { folderId, targetId, targetKind, placement } = next;
      return { folderId, targetId, targetKind, placement };
    },
    clear: () => { clearTarget(); target = null; delete root.dataset.dropHint; }
  };
}

import { COLORS, DEFAULT_SPACE_COLOR, matchingTabs, openTabsForSpace, pageLabel } from './model.js';
import { icon } from './icons.js';
import { connect } from './platform.js';
import { openIconPicker } from './icon-picker.js';
import { pinnedEntries } from './pinned-order.js';
import { createSavedItemDrag } from './pin-drag.js';
import { createFavoriteDrag } from './favorite-drag.js';

const $ = selector => document.querySelector(selector);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, iconName, className, action) => {
  const node = make('button', className);
  node.type = 'button';
  node.title = label;
  node.setAttribute('aria-label', label);
  if (iconName) node.append(icon(iconName));
  node.addEventListener('click', action);
  return node;
};

document.querySelectorAll('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)));
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => $(`#${node.dataset.close}`).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
}));

let platform;
let state;
let revision = 0;
let refreshTimer;
let toastTimer;
let draggingId = null;
let draggingPinned = false;
let draggingFavorites = false;
let deferredState;
let searchIndex = 0;
let results = [];
let editingSpace;
let selectedColor = DEFAULT_SPACE_COLOR;
let selectedSpaceBackground = null;
let selectedIcon = 'sun';
let selectedIconColor = null;
let editingFolder;
let folderSpaceId;
let folderPageId;
let folderAppearance;
let deleteArmed = false;
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = isMac ? '⌘ K' : 'Ctrl K';
$('#search-shortcut').textContent = shortcut;
$('#settings-shortcut').textContent = shortcut;
$('#panel-shortcut').textContent = isMac ? '⌘ ⇧ E' : 'Ctrl Shift E';
$('#new-tab kbd').textContent = shortcut;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3200);
}

async function refresh() {
  const ticket = ++revision;
  try {
    const next = await platform.request('GET_STATE');
    if (ticket === revision) applyState(next);
  } catch (error) { toast(error.message, true); }
}

async function command(type, payload, success) {
  const ticket = ++revision;
  try {
    const next = await platform.request(type, payload);
    if (ticket === revision) applyState(next);
    if (success) toast(success);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

function applyTheme() {
  if (!state) return;
  const space = state.spaces.find(space => space.id === state.spaceId);
  const color = COLORS[space.color];
  const root = document.documentElement;
  const mode = state.theme === 'system' ? (darkMode.matches ? 'dark' : 'light') : state.theme;
  root.dataset.mode = mode;
  root.style.setProperty('--space-light', color.light);
  root.style.setProperty('--space-dark', color.dark);
  root.style.setProperty('--space-accent', mode === 'dark' ? color.darkAccent : color.accent);
  if (state.backgroundColor) root.style.setProperty('--background', state.backgroundColor);
  else root.style.removeProperty('--background');
  const folderBackground = space.backgroundColor || (space.color !== DEFAULT_SPACE_COLOR
    ? `color-mix(in srgb, var(--space-${mode}) ${mode === 'dark' ? 92 : 65}%, white)` : null);
  if (folderBackground) {
    root.style.setProperty('--folder-background', folderBackground);
    root.style.setProperty('--selected-space-background', 'var(--folder-background)');
  } else {
    root.style.removeProperty('--folder-background');
    root.style.removeProperty('--selected-space-background');
  }
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--background').trim();
  document.querySelectorAll('[data-theme]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.theme === state.theme)));
  $('#custom-background').checked = Boolean(state.backgroundColor);
  $('#background-controls').hidden = !state.backgroundColor;
  $('#background-color').value = state.backgroundColor ?? (mode === 'dark' ? '#1b1e23' : '#eceef0');
  $('#background-hex').value = $('#background-color').value;
  $('#background-hex').setCustomValidity('');
}
darkMode.addEventListener('change', applyTheme);

function favicon(page) {
  const wrapper = make('span', `favicon${page.status === 'loading' ? ' loading' : ''}`);
  if (page.icon) {
    wrapper.classList.remove('loading');
    wrapper.append(icon(page.icon, page.iconColor));
    return wrapper;
  }
  if (page.status === 'loading') return wrapper;
  const url = page.url || page.pendingUrl || '';
  if (!/^https?:/i.test(url)) { wrapper.append(icon('globe')); return wrapper; }
  const source = platform.favicon(url);
  if (source) {
    const image = make('img');
    image.alt = '';
    image.src = source;
    image.addEventListener('error', () => wrapper.replaceChildren(icon('globe')), { once: true });
    wrapper.append(image);
  } else {
    const known = { 'github.com': '⌘', 'mail.google.com': 'M', 'notion.so': 'N', 'www.notion.so': 'N',
      'figma.com': 'F', 'www.figma.com': 'F', 'open.spotify.com': '◉', 'developer.chrome.com': '◈' };
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    wrapper.textContent = known[host] ?? pageLabel(url).charAt(0).toUpperCase();
  }
  return wrapper;
}

function applyState(next) {
  if (draggingId !== null || draggingPinned || draggingFavorites) { deferredState = next; return; }
  const focusKey = document.activeElement?.dataset.focusKey;
  state = next;
  document.documentElement.style.setProperty('--font-scale', state.fontScale / 100);
  applyTheme();
  $('#search-button').hidden = !state.showSearchBar;
  $('#show-search-bar').checked = state.showSearchBar;
  $('#show-favorite-labels').checked = state.showFavoriteLabels;
  $('#favorites-per-row').value = String(state.favoritesPerRow);
  $('#font-size').value = String(state.fontScale);
  const space = state.spaces.find(space => space.id === state.spaceId);
  $('#space-name').textContent = space.name;
  document.title = `${space.name} — Arclet`;
  renderFavorites();
  renderPins();
  renderTabs();
  renderSpaces();
  if ($('#search-dialog').open) renderSearch(false);
  if (focusKey) document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function currentTab() { return state?.tabs.find(tab => tab.active); }
function saveCurrent(kind) {
  const tab = currentTab();
  if (!tab) { toast('Open a page first.', true); return; }
  return command('SAVE_PAGE', { kind, tabId: tab.id }, kind === 'favorite' ? 'Added to your favorites.' : 'Pinned to this space.');
}

function renderFavorites() {
  const grid = $('#favorites');
  $('.favorites-section').hidden = state.favorites.length === 0;
  grid.style.setProperty('--favorite-columns', Math.min(state.favoritesPerRow, Math.max(1, state.favorites.length)));
  grid.classList.toggle('favorites--icons-only', !state.showFavoriteLabels);
  grid.replaceChildren();
  for (const page of state.favorites) {
    const wrapper = make('div', 'favorite-wrap');
    const node = button(page.title, null, 'favorite', () => command('OPEN_PAGE', { id: page.id }));
    node.dataset.focusKey = `favorite-${page.id}`;
    node.dataset.favoriteId = page.id;
    node.addEventListener('keydown', event => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      favoriteOrderingActions(page).find(entry => entry.label === (event.key === 'ArrowLeft' ? 'Move left' : 'Move right'))?.action();
    });
    node.append(favicon(page));
    if (state.showFavoriteLabels) node.append(make('span', 'favorite-label', pageLabel(page.url)));
    bindContextMenu(node, (x, y) => openMenu(x, y, [
      { label: 'Customize icon', icon: 'palette', action: () => editPageIcon(page, 'favorite') },
      ...favoriteOrderingActions(page),
      { label: 'Remove favorite', icon: 'close', action: () => command('REMOVE_PAGE', { kind: 'favorite', id: page.id }) }
    ]));
    wrapper.append(node);
    grid.append(wrapper);
  }
}

function favoriteOrderingActions(page) {
  const index = state.favorites.findIndex(item => item.id === page.id);
  const previous = state.favorites[index - 1];
  const next = state.favorites[index + 1];
  const move = (target, placement) => command('REORDER_FAVORITE', { id: page.id, targetId: target.id, placement });
  return [
    ...(index > 0 ? [{ label: 'Move left', icon: 'arrow-left', action: () => move(previous, 'before') }] : []),
    ...(index >= 0 && next ? [{ label: 'Move right', icon: 'arrow-right', action: () => move(next, 'after') }] : [])
  ];
}

const favoritesDrag = createFavoriteDrag({ root: $('#favorites'), scroll: $('.favorites-section'),
  onStart: () => { draggingFavorites = true; closeMenu(); },
  onEnd: finishDrag,
  onDrop: ({ id, targetId, placement }) => command('REORDER_FAVORITE', { id, targetId, placement })
});

function favoriteAction(page, source) {
  const saved = state.favorites.find(favorite => favorite.url === page.url);
  return saved
    ? { label: 'Remove from favorites', icon: 'star', action: () => command('REMOVE_PAGE', { kind: 'favorite', id: saved.id }) }
    : { label: 'Add to favorites', icon: 'star', action: () => command('SAVE_PAGE', { kind: 'favorite', ...source }, 'Added to your favorites.') };
}

function bindContextMenu(node, show) {
  node.addEventListener('contextmenu', event => { event.preventDefault(); show(event.clientX, event.clientY); });
  node.addEventListener('keydown', event => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      show(rect.left + 20, rect.bottom);
    }
  });
}

function pageRow(page) {
  const matches = state.tabs.filter(tab => tab.spaceId === page.spaceId && tab.url === page.url);
  const liveTab = matches.find(tab => tab.active) ?? matches[0];
  const active = Boolean(liveTab?.active);
  const row = make('div', `tab-row${active ? ' active' : ''}`);
  identifyPinnedRow(row, 'pin', page);
  const main = button(page.title, null, 'tab-main', () => command('OPEN_PAGE', { id: page.id }));
  main.dataset.focusKey = `pin-${page.id}`;
  main.append(favicon(page), make('span', 'tab-title', page.title));
  const remove = button(`Unpin ${page.title}`, 'close', 'tab-action', () => command('REMOVE_PAGE', { kind: 'pin', id: page.id }));
  row.append(main, remove);
  bindContextMenu(row, (x, y) => openMenu(x, y, [
    { label: 'Customize icon', icon: 'palette', action: () => editPageIcon(page, 'pin') },
    { label: 'Move to folder', icon: 'folder-input', action: () => openPinFolders(page, x, y) },
    ...orderingActions('pin', page),
    favoriteAction(page, { pageId: page.id }),
    ...(liveTab ? [
      { label: liveTab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab', icon: liveTab.mutedInfo?.muted ? 'volume' : 'muted', action: () => command('MUTE_TAB', { id: liveTab.id }) },
      { label: 'Close tab', icon: 'close', action: () => command('CLOSE_TAB', { id: liveTab.id }) }
    ] : []),
    { separator: true },
    { label: 'Unpin page', icon: 'pin', action: () => command('REMOVE_PAGE', { kind: 'pin', id: page.id }) }
  ]));
  return row;
}

function identifyPinnedRow(node, kind, item) {
  node.dataset.pinKind = kind;
  node.dataset.pinId = item.id;
  node.dataset.pinLabel = item.name ?? item.title;
  node.dataset.pinFolder = kind === 'pin' ? item.folderId ?? '' : '';
  node.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const label = event.key === 'ArrowUp' ? 'Move up' : 'Move down';
    orderingActions(kind, item).find(action => action.label === label)?.action();
  });
}

function orderingActions(kind, item) {
  const folderId = kind === 'pin' ? item.folderId ?? null : null;
  const siblings = pinnedEntries(state, item.spaceId, folderId);
  const index = siblings.findIndex(entry => entry.kind === kind && entry.item.id === item.id);
  const actions = [];
  const move = (target, placement) => command('MOVE_PINNED', {
    kind, id: item.id, folderId, targetKind: target.kind, targetId: target.item.id, placement
  });
  if (index > 0) actions.push({ label: 'Move up', icon: 'arrow-up', action: () => move(siblings[index - 1], 'before') });
  if (index >= 0 && index < siblings.length - 1) actions.push({ label: 'Move down', icon: 'arrow-down', action: () => move(siblings[index + 1], 'after') });
  return actions;
}

function folderRow(folder) {
  const children = pinnedEntries(state, folder.spaceId, folder.id);
  const group = make('div', 'pin-folder');
  const heading = button(folder.name, null, 'folder-heading', () => command('TOGGLE_FOLDER', { id: folder.id }));
  identifyPinnedRow(heading, 'folder', folder);
  heading.dataset.focusKey = `folder-${folder.id}`;
  heading.setAttribute('aria-expanded', String(!folder.collapsed));
  heading.setAttribute('aria-controls', `folder-contents-${folder.id}`);
  const arrow = icon('chevronDown');
  arrow.classList.add('folder-chevron');
  heading.append(arrow, icon(folder.icon, folder.iconColor), make('span', 'tab-title', folder.name));
  const contents = make('div', 'folder-children tab-list');
  contents.id = `folder-contents-${folder.id}`;
  contents.hidden = folder.collapsed;
  contents.setAttribute('role', 'group');
  contents.setAttribute('aria-label', folder.name);
  contents.append(...children.map(({ item }) => pageRow(item)));
  if (!children.length) contents.append(make('p', 'folder-empty', 'Drop a tab on this folder to pin it here.'));
  group.append(heading, contents);
  bindContextMenu(heading, (x, y) => openMenu(x, y, [
    { label: 'Edit folder', icon: 'edit', action: () => openFolderEditor(folder) },
    ...orderingActions('folder', folder),
    { label: 'New folder', icon: 'folder-plus', action: () => openFolderEditor() },
    { separator: true },
    { label: 'Remove folder, keep pages', icon: 'trash', action: () => command('DELETE_FOLDER', { id: folder.id }, 'Folder removed. Its pinned pages were kept.') }
  ]));
  return group;
}

function renderPins() {
  const entries = pinnedEntries(state, state.spaceId);
  const list = $('#pins');
  list.replaceChildren(...entries.map(({ kind, item }) => kind === 'folder' ? folderRow(item) : pageRow(item)));
  const outside = make('div', 'pin-root-drop', 'Drop here outside folders');
  outside.dataset.pinRootDrop = '';
  list.append(outside);
  $('.pins-section').hidden = entries.length === 0;
  $('#pins-divider').hidden = entries.length === 0;
}

const pinnedDrag = createSavedItemDrag({
  root: $('#pins'), scroll: $('.content-scroll'),
  onStart: () => { draggingPinned = true; closeMenu(); },
  onEnd: finishDrag,
  onDrop: payload => command('MOVE_PINNED', payload)
});
$('#pins').addEventListener('dragover', event => {
  if (draggingId !== null) pinnedDrag.nativeOver({ kind: 'tab', id: draggingId }, event);
});
$('#pins').addEventListener('dragleave', event => {
  if (!$('#pins').contains(event.relatedTarget)) pinnedDrag.clear();
});
$('#pins').addEventListener('drop', event => {
  if (draggingId === null) return;
  const tabId = draggingId;
  const drop = pinnedDrag.nativeDrop({ kind: 'tab', id: tabId }, event);
  finishDrag();
  if (drop) command('SAVE_PAGE', { kind: 'pin', tabId, spaceId: state.spaceId, ...drop }, 'Pinned in place.');
});

function editPageIcon(page, kind) {
  openIconPicker({ appearance: page, optional: true, title: 'Customize page icon',
    onApply: appearance => command('SET_PAGE_ICON', { id: page.id, kind, ...appearance }) });
}

function openPinFolders(page, x, y) {
  openMenu(x, y, [
    ...(page.folderId ? [{ label: 'Move out of folder', icon: 'folder-output', action: () => command('MOVE_PIN', { id: page.id, folderId: null }) }] : []),
    ...state.folders.filter(folder => folder.spaceId === page.spaceId && folder.id !== page.folderId).map(folder => ({
      label: folder.name, icon: folder.icon, iconColor: folder.iconColor, action: () => command('MOVE_PIN', { id: page.id, folderId: folder.id })
    })),
    { label: 'New folder with this page', icon: 'folder-plus', action: () => openFolderEditor(null, page.spaceId, page.id) }
  ]);
}

function renderTabs() {
  const list = $('#tabs');
  const tabs = openTabsForSpace(state.tabs, state.pins, state.spaceId, state.favorites);
  $('#empty-tabs').hidden = tabs.length > 0;
  const allSaved = !tabs.length && state.tabs.some(tab => tab.spaceId === state.spaceId);
  $('#empty-tabs p').textContent = allSaved ? 'Your tabs are saved above.' : 'A little room to think.';
  $('#empty-tabs > span:last-child').textContent = allSaved ? 'Open a new tab to keep exploring.' : 'Open a tab and make this space yours.';
  list.replaceChildren();
  for (const tab of tabs) {
    const row = make('div', `tab-row${tab.active ? ' active' : ''}${tab.discarded ? ' discarded' : ''}`);
    row.draggable = true;
    row.dataset.tabId = tab.id;
    const main = button(`${tab.title || 'New tab'}\n${tab.url || ''}`, null, 'tab-main', () => command('ACTIVATE_TAB', { id: tab.id }));
    main.dataset.focusKey = `tab-${tab.id}`;
    if (tab.active) main.setAttribute('aria-current', 'page');
    main.append(favicon(tab), make('span', 'tab-title', tab.title || 'New tab'));
    row.append(main);
    if (tab.audible || tab.mutedInfo?.muted) {
      row.append(button(tab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab', tab.mutedInfo?.muted ? 'muted' : 'volume', 'tab-action audible', () => command('MUTE_TAB', { id: tab.id })));
    }
    row.append(button(`Close ${tab.title || 'tab'}`, 'close', 'tab-action', () => command('CLOSE_TAB', { id: tab.id })));
    const showTabMenu = (x, y) => {
      openMenu(x, y, [
        { label: 'Pin to this space', icon: 'pin', action: () => command('SAVE_PAGE', { kind: 'pin', tabId: tab.id }, 'Pinned to this space.') },
        favoriteAction(tab, { tabId: tab.id }),
        { label: tab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab', icon: tab.mutedInfo?.muted ? 'volume' : 'muted', action: () => command('MUTE_TAB', { id: tab.id }) },
        { heading: 'MOVE TO SPACE' },
        ...state.spaces.filter(space => space.id !== tab.spaceId).map(space => ({ label: space.name, icon: space.icon, iconColor: space.iconColor, action: () => command('MOVE_TAB', { id: tab.id, spaceId: space.id }, `Moved to ${space.name}.`) })),
        { separator: true },
        { label: 'Close tab', icon: 'close', action: () => command('CLOSE_TAB', { id: tab.id }) },
        { label: 'Close all tabs below', icon: 'list-end', disabled: tabs.at(-1)?.id === tab.id,
          action: () => command('CLOSE_OPEN_TABS', { mode: 'below', id: tab.id, spaceId: tab.spaceId }, 'Tabs below closed.') },
        { label: 'Close all tabs', icon: 'copy-x', action: () => command('CLOSE_OPEN_TABS', { mode: 'all', spaceId: tab.spaceId }, 'Open tabs closed.') }
      ]);
    };
    bindContextMenu(row, showTabMenu);
    row.addEventListener('dragstart', event => {
      draggingId = tab.id;
      document.body.classList.add('tab-dragging');
      $('.pins-section').hidden = false;
      event.dataTransfer.setData('text/plain', String(tab.id));
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', finishDrag);
    row.addEventListener('dragover', event => {
      if (draggingId === null || draggingId === tab.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', event => {
      if (draggingId === null) return;
      event.preventDefault();
      const id = draggingId;
      finishDrag();
      if (id !== tab.id) command('REORDER_TAB', { id, targetId: tab.id });
    });
    list.append(row);
  }
}

function finishDrag() {
  draggingId = null;
  draggingPinned = false;
  draggingFavorites = false;
  document.body.classList.remove('tab-dragging');
  pinnedDrag.clear();
  favoritesDrag.clear();
  if (state) $('.pins-section').hidden = pinnedEntries(state, state.spaceId).length === 0;
  document.querySelectorAll('.dragging, .drag-over, .drop-target').forEach(node => node.classList.remove('dragging', 'drag-over', 'drop-target'));
  if (deferredState) { const next = deferredState; deferredState = null; applyState(next); }
}

function renderSpaces() {
  const list = $('#spaces');
  list.replaceChildren();
  for (const space of state.spaces) {
    const count = state.tabs.filter(tab => tab.spaceId === space.id).length;
    const node = button(`${space.name} · ${count} ${count === 1 ? 'tab' : 'tabs'}`, space.icon, 'space-button', () => command('SELECT_SPACE', { id: space.id }));
    if (space.iconColor) node.querySelector('svg').style.color = space.iconColor;
    const selected = space.id === state.spaceId;
    node.setAttribute('aria-current', String(selected));
    if (selected) node.append(make('span', 'space-label', space.name));
    node.title += '\nRight-click for space actions';
    node.dataset.spaceId = space.id;
    node.dataset.focusKey = `space-${space.id}`;
    node.addEventListener('contextmenu', event => {
      event.preventDefault();
      openSpaceActions(space, event.clientX, event.clientY);
    });
    node.addEventListener('keydown', event => {
      if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
        event.preventDefault();
        const rect = node.getBoundingClientRect();
        openSpaceActions(space, rect.left, rect.top);
      }
    });
    node.addEventListener('dragover', event => {
      if (draggingId === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', event => {
      if (draggingId === null) return;
      event.preventDefault();
      const id = draggingId;
      finishDrag();
      command('MOVE_TAB', { id, spaceId: space.id }, `Moved to ${space.name}.`);
    });
    list.append(node);
  }
  list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function openSearch() {
  if (!state) return;
  closeMenu();
  $('#search-input').value = '';
  searchIndex = 0;
  renderSearch();
  $('#search-dialog').showModal();
  $('#search-input').focus();
}

function renderSearch(reset = true) {
  const query = $('#search-input').value;
  results = matchingTabs(state.tabs, query).slice(0, 20);
  if (reset) searchIndex = query.trim() ? (results.length ? 0 : results.length) : results.length;
  searchIndex = Math.min(searchIndex, results.length);
  const list = $('#search-results');
  list.replaceChildren();
  results.forEach((tab, index) => {
    const node = button(`Switch to ${tab.title || 'New tab'}`, null, 'search-result', () => chooseSearch(index));
    node.id = `result-${tab.id}`;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(index === searchIndex));
    node.tabIndex = -1;
    const text = make('span', 'result-text');
    text.append(make('span', 'result-title', tab.title || 'New tab'), make('span', 'result-url', pageLabel(tab.url)));
    const space = state.spaces.find(space => space.id === tab.spaceId);
    node.append(favicon(tab), text, make('span', 'result-space', space?.name || ''));
    list.append(node);
  });
  if (!results.length) list.append(make('p', 'no-results', query ? 'No matching tabs. Start somewhere new.' : 'Your next idea starts here.'));
  $('#search-action').textContent = query.trim() ? `Open “${query.trim()}”` : 'Open a new tab';
  updateSearchSelection();
}

function updateSearchSelection() {
  document.querySelectorAll('.search-result').forEach((node, index) => {
    node.setAttribute('aria-selected', String(index === searchIndex));
    if (index === searchIndex) {
      $('#search-input').setAttribute('aria-activedescendant', node.id);
      node.scrollIntoView({ block: 'nearest' });
    }
  });
  $('#open-search').classList.toggle('selected', searchIndex === results.length);
  if (searchIndex === results.length) $('#search-input').removeAttribute('aria-activedescendant');
}

async function chooseSearch(index) {
  const input = $('#search-input').value;
  const tab = results[index];
  $('#search-dialog').close();
  if (tab) await command('ACTIVATE_TAB', { id: tab.id });
  else await command('NEW_TAB', { input });
}

$('#search-button').addEventListener('click', openSearch);
$('#new-tab').addEventListener('click', openSearch);
$('#close-search').addEventListener('click', () => $('#search-dialog').close());
$('#search-input').addEventListener('input', () => renderSearch());
$('#search-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) {
    // Handle Enter before the form's implicit click on its submit button.
    event.preventDefault();
    chooseSearch(searchIndex);
    return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const count = results.length + 1;
  searchIndex = (searchIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
  updateSearchSelection();
});
$('#search-form').addEventListener('submit', event => { event.preventDefault(); chooseSearch(searchIndex); });
$('#open-search').addEventListener('click', event => { event.preventDefault(); chooseSearch(results.length); });

function openSpaceEditor(space) {
  if (!state) return;
  editingSpace = space;
  selectedColor = space?.color ?? DEFAULT_SPACE_COLOR;
  selectedSpaceBackground = space?.backgroundColor ?? null;
  selectedIcon = space?.icon ?? 'sun';
  selectedIconColor = space?.iconColor ?? null;
  deleteArmed = false;
  $('#space-input').value = space?.name ?? '';
  $('#space-dialog-title').textContent = space ? 'Your space, your way.' : 'A new space';
  $('#save-space').textContent = space ? 'Save changes' : 'Create space';
  $('#delete-space').hidden = !space || state.spaces.length < 2;
  $('#delete-space').textContent = 'Delete space';
  $('#space-delete-note').hidden = true;
  renderSpaceOptions();
  $('#space-dialog').showModal();
  $('#space-input').focus();
}

function renderSpaceOptions() {
  const colors = $('#color-options');
  colors.replaceChildren();
  Object.entries(COLORS).forEach(([key, color]) => {
    const selected = key === selectedColor && !selectedSpaceBackground;
    const node = button(color.label, selected ? 'check' : null, 'color-option', () => { selectedColor = key; selectedSpaceBackground = null; renderSpaceOptions(); $(`#color-${key}`).focus(); });
    node.id = `color-${key}`;
    node.style.background = color.light;
    node.setAttribute('aria-pressed', String(selected));
    colors.append(node);
  });
  $('#space-custom-background').checked = Boolean(selectedSpaceBackground);
  $('#space-background-controls').hidden = !selectedSpaceBackground;
  $('#space-background-color').value = selectedSpaceBackground ?? COLORS[selectedColor][document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'];
  $('#space-background-hex').value = $('#space-background-color').value;
  $('#space-background-hex').setCustomValidity('');
  renderAppearanceButton($('#space-appearance'), { icon: selectedIcon, iconColor: selectedIconColor });
}

$('#space-custom-background').addEventListener('change', event => {
  selectedSpaceBackground = event.currentTarget.checked ? $('#space-background-color').value : null;
  renderSpaceOptions();
});
$('#space-background-color').addEventListener('change', event => {
  selectedSpaceBackground = event.currentTarget.value;
  renderSpaceOptions();
});
$('#space-background-hex').addEventListener('input', event => event.currentTarget.setCustomValidity(''));
$('#space-background-hex').addEventListener('change', event => {
  const input = event.currentTarget;
  const value = input.value.trim();
  input.setCustomValidity(/^#[0-9a-f]{6}$/i.test(value) ? '' : 'Enter a six-digit hex color, such as #f5f6f7.');
  if (input.reportValidity()) {
    selectedSpaceBackground = value.toLowerCase();
    renderSpaceOptions();
  }
});
$('#reset-space-background').addEventListener('click', () => {
  selectedSpaceBackground = null;
  renderSpaceOptions();
  $('#space-custom-background').focus();
});

function renderAppearanceButton(node, appearance) {
  node.replaceChildren(icon(appearance.icon, appearance.iconColor), make('span', '', 'Choose icon & color'), icon('chevronDown'));
}
$('#space-appearance').addEventListener('click', () => openIconPicker({
  appearance: { icon: selectedIcon, iconColor: selectedIconColor }, onApply: appearance => {
    selectedIcon = appearance.icon;
    selectedIconColor = appearance.iconColor;
    renderSpaceOptions();
  }
}));

function openFolderEditor(folder, spaceId = state.spaceId, pageId) {
  editingFolder = folder;
  folderSpaceId = folder?.spaceId ?? spaceId;
  folderPageId = pageId;
  folderAppearance = { icon: folder?.icon ?? 'folder', iconColor: folder?.iconColor ?? null };
  $('#folder-dialog-title').textContent = folder ? 'Edit pinned folder' : 'New pinned folder';
  $('#folder-input').value = folder?.name ?? '';
  $('#save-folder').textContent = folder ? 'Save changes' : 'Create folder';
  renderAppearanceButton($('#folder-appearance'), folderAppearance);
  $('#folder-dialog').showModal();
  $('#folder-input').focus();
}
$('#folder-appearance').addEventListener('click', () => openIconPicker({ appearance: folderAppearance,
  onApply: appearance => { folderAppearance = appearance; renderAppearanceButton($('#folder-appearance'), appearance); }
}));
$('#folder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const node = $('#save-folder');
  node.disabled = true;
  const ok = await command('SAVE_FOLDER', { id: editingFolder?.id, spaceId: folderSpaceId, pageId: folderPageId,
    name: $('#folder-input').value, ...folderAppearance });
  node.disabled = false;
  if (ok) $('#folder-dialog').close();
});

$('#add-space').addEventListener('click', () => openSpaceEditor());
$('#space-form').addEventListener('submit', async event => {
  event.preventDefault();
  const save = $('#save-space');
  save.disabled = true;
  const ok = await command('SAVE_SPACE', { id: editingSpace?.id, name: $('#space-input').value, color: selectedColor, backgroundColor: selectedSpaceBackground, icon: selectedIcon, iconColor: selectedIconColor });
  save.disabled = false;
  if (ok) $('#space-dialog').close();
});
$('#delete-space').addEventListener('click', async () => {
  if (!deleteArmed) {
    deleteArmed = true;
    $('#delete-space').textContent = 'Delete & move tabs';
    $('#space-delete-note').hidden = false;
    return;
  }
  if (await command('DELETE_SPACE', { id: editingSpace.id }, 'Space deleted. Your tabs and pinned pages were moved.')) $('#space-dialog').close();
});

function closeMenu() { $('#context-menu').hidden = true; }
function openMenu(x, y, entries) {
  const menu = $('#context-menu');
  menu.replaceChildren();
  entries.forEach(entry => {
    if (entry.heading) { menu.append(make('div', 'menu-heading', entry.heading)); return; }
    if (entry.separator) { menu.append(make('div', 'menu-separator')); return; }
    const node = button(entry.label, entry.icon, '', () => { closeMenu(); entry.action(); });
    node.disabled = Boolean(entry.disabled);
    if (entry.iconColor) node.querySelector('svg')?.style.setProperty('color', entry.iconColor);
    node.setAttribute('role', 'menuitem');
    node.append(make('span', '', entry.label));
    menu.append(node);
  });
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
$('#context-menu').addEventListener('keydown', event => {
  const items = [...$('#context-menu').querySelectorAll('button:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu')) closeMenu(); });
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!document.querySelector('dialog[open]')) openSearch();
  }
  if (event.key === 'Escape') closeMenu();
});
function openSpaceActions(space, x, y) {
  openMenu(x, y, [
    { label: `Edit ${space.name}`, icon: 'edit', action: () => openSpaceEditor(space) },
    { label: 'New pinned folder', icon: 'folder-plus', action: () => openFolderEditor(null, space.id) },
    ...(space.id === state.spaceId ? [{ label: 'Pin current page', icon: 'pin', action: () => saveCurrent('pin') }] : []),
    ...(space.id === state.spaceId ? [{ label: 'Restore last closed tab', icon: 'history', action: () => command('RESTORE_TAB', {}, 'Tab restored.') }] : []),
    { label: 'New space', icon: 'plus', action: () => openSpaceEditor() }
  ]);
}
function openContentActions(x, y) {
  const targetSpace = state.spaceId;
  const tabs = openTabsForSpace(state.tabs, state.pins, targetSpace, state.favorites);
  openMenu(x, y, [
    { label: 'New pinned folder', icon: 'folder-plus', action: () => openFolderEditor() },
    { label: 'Pin current page', icon: 'pin', action: () => saveCurrent('pin') },
    { label: 'Restore last closed tab', icon: 'history', action: () => command('RESTORE_TAB', {}, 'Tab restored.') },
    { separator: true },
    { label: 'Close all tabs', icon: 'copy-x', disabled: !tabs.length,
      action: () => command('CLOSE_OPEN_TABS', { mode: 'all', spaceId: targetSpace }, 'Open tabs closed.') }
  ]);
}
bindContextMenu($('#new-tab'), openContentActions);
$('.folder-content').addEventListener('contextmenu', event => {
  if (event.defaultPrevented || event.target.closest('button, .tab-row, .pin-folder')) return;
  event.preventDefault();
  openContentActions(event.clientX, event.clientY);
});
$('#settings-button').addEventListener('click', () => { if (state) $('#settings-dialog').showModal(); });
document.querySelectorAll('[data-theme]').forEach(node => node.addEventListener('click', () => command('SET_THEME', { theme: node.dataset.theme })));
async function setBackgroundColor(color) {
  const controls = ['#custom-background', '#background-color', '#background-hex', '#reset-background'].map($);
  controls.forEach(node => { node.disabled = true; });
  const ok = await command('SET_BACKGROUND_COLOR', { color });
  controls.forEach(node => { node.disabled = false; });
  if (!ok) applyTheme();
}
$('#custom-background').addEventListener('change', event => setBackgroundColor(event.currentTarget.checked ? $('#background-color').value : null));
$('#background-color').addEventListener('change', event => setBackgroundColor(event.currentTarget.value));
$('#background-hex').addEventListener('input', event => event.currentTarget.setCustomValidity(''));
$('#background-hex').addEventListener('change', event => {
  const input = event.currentTarget;
  const value = input.value.trim();
  input.setCustomValidity(/^#[0-9a-f]{6}$/i.test(value) ? '' : 'Enter a six-digit hex color, such as #eceef0.');
  if (input.reportValidity()) setBackgroundColor(value);
});
$('#reset-background').addEventListener('click', () => setBackgroundColor(null));
$('#show-search-bar').addEventListener('change', async event => {
  const toggle = event.currentTarget;
  toggle.disabled = true;
  const ok = await command('SET_SEARCH_VISIBILITY', { visible: toggle.checked });
  toggle.disabled = false;
  if (!ok) toggle.checked = state.showSearchBar;
});
$('#show-favorite-labels').addEventListener('change', async event => {
  const toggle = event.currentTarget;
  toggle.disabled = true;
  const ok = await command('SET_FAVORITE_LABELS', { visible: toggle.checked });
  toggle.disabled = false;
  if (!ok) toggle.checked = state.showFavoriteLabels;
});
$('#favorites-per-row').addEventListener('change', async event => {
  const select = event.currentTarget;
  select.disabled = true;
  const ok = await command('SET_FAVORITES_PER_ROW', { count: Number(select.value) });
  select.disabled = false;
  if (!ok) select.value = String(state.favoritesPerRow);
});
$('#font-size').addEventListener('change', async event => {
  const select = event.currentTarget;
  select.disabled = true;
  const ok = await command('SET_FONT_SCALE', { scale: Number(select.value) });
  select.disabled = false;
  if (!ok) select.value = String(state.fontScale);
});

try {
  platform = await connect();
  if (platform.demo) $('#footer-note').textContent = 'Preview mode · sample tabs';
  platform.subscribe(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 70);
  });
  await refresh();
} catch (error) { toast(error.message, true); }

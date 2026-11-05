import { CONTROL_FAVORITES } from './home-page.js';
import { COLORS, DEFAULT_SPACE_COLOR, FONT_SCALES, MAX_FAVORITES_PER_ROW, defaultData, pageLabel, safeSavedUrl } from './model.js';
import { hasIcon } from './icons.js';
import { normalizePinnedOrder } from './pinned-order.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value.filter(object) : [];
const label = (value, max, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
const appearance = (value, fallback) => {
  const icon = hasIcon(value.icon) ? value.icon : fallback;
  return { icon, iconColor: icon ? hex(value.iconColor) : null };
};

// Storage is an upgrade boundary too. Repair presentation fields independently
// so one bad palette or old preference cannot hide otherwise valid saved pages.
export function normalizeStoredData(value) {
  const defaults = defaultData();
  const source = object(value) ? value : defaults;
  const usedIds = new Set(CONTROL_FAVORITES.map(item => item.id));
  const id = candidate => {
    const result = typeof candidate === 'string' && candidate.trim() && !usedIds.has(candidate) ? candidate : crypto.randomUUID();
    usedIds.add(result);
    return result;
  };
  let spaces = list(source.spaces).slice(0, 12).map(space => ({
    ...space, id: id(space.id), name: label(space.name, 32, 'Space'),
    color: Object.hasOwn(COLORS, space.color) ? space.color : DEFAULT_SPACE_COLOR,
    backgroundColor: hex(space.backgroundColor), ...appearance(space, 'sun')
  }));
  if (!spaces.length) spaces = defaults.spaces.map(space => ({ ...space, id: id(space.id) }));
  const spaceId = candidate => spaces.some(space => space.id === candidate) ? candidate : spaces[0].id;
  const folders = list(source.folders).map(folder => ({
    ...folder, id: id(folder.id), spaceId: spaceId(folder.spaceId),
    name: label(folder.name, 64, 'Folder'), collapsed: folder.collapsed === true, ...appearance(folder, 'folder')
  }));
  function pages(values, pinned) {
    const urls = new Set();
    return list(values).flatMap(page => {
      let url;
      try { url = safeSavedUrl(page.url); } catch { return []; }
      const target = pinned ? spaceId(page.spaceId) : null;
      const key = JSON.stringify([target, url]);
      if (!pinned && urls.has(key)) return [];
      urls.add(key);
      const result = { ...page, id: id(page.id), url, title: label(page.title, 200, pageLabel(url)),
        ...(page.icon === undefined && page.iconColor === undefined ? {} : appearance(page, null)) };
      if (pinned) {
        result.spaceId = target;
        if (!folders.some(folder => folder.id === page.folderId && folder.spaceId === target)) delete result.folderId;
      } else { delete result.spaceId; delete result.folderId; }
      return [result];
    });
  }
  const data = { ...defaults, ...source, version: 1, spaces, folders,
    favorites: pages(source.favorites, false), pins: pages(source.pins, true),
    ...Object.fromEntries(CONTROL_FAVORITES.flatMap(item => [
      [item.urlKey, (() => { try { return source[item.urlKey] ? safeSavedUrl(source[item.urlKey]) : null; } catch { return null; } })()],
      [item.titleKey, label(source[item.titleKey], 200, item.title)]
    ])),
    theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : defaults.theme,
    backgroundColor: hex(source.backgroundColor),
    pageControlsPosition: ['left', 'right'].includes(source.pageControlsPosition) ? source.pageControlsPosition : defaults.pageControlsPosition,
    favoritesPerRow: Number.isInteger(source.favoritesPerRow) && source.favoritesPerRow >= 1 && source.favoritesPerRow <= MAX_FAVORITES_PER_ROW ? source.favoritesPerRow : defaults.favoritesPerRow,
    fontScale: FONT_SCALES.includes(source.fontScale) ? source.fontScale : defaults.fontScale
  };
  for (const key of ['showSearchBar', 'showUrlBar', 'showFavoriteLabels']) data[key] = typeof source[key] === 'boolean' ? source[key] : defaults[key];
  normalizePinnedOrder(data);
  return data;
}

import { COLORS, DEFAULT_SPACE_COLOR, FONT_SCALES, MAX_FAVORITES_PER_ROW, defaultData, iconAppearance, pageLabel, safeSavedUrl } from './model.js';
import { normalizePinnedOrder, pinnedEntries } from './pinned-order.js';

export const TRANSFER_FORMAT = 'arclet';
export const TRANSFER_VERSION = 1;
export const MAX_TRANSFER_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 10000;
const SETTINGS = ['theme', 'backgroundColor', 'showSearchBar', 'pageControlsPosition', 'showFavoriteLabels', 'favoritesPerRow', 'fontScale'];
const PAGE_FIELDS = ['url', 'title', 'icon', 'iconColor'];
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
function object(value, path, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object.');
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(path, `unknown field “${key}”.`);
  return value;
}
function list(value, path, fallback = []) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) fail(path, 'expected an array.');
  return value;
}
function text(value, path, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(path, `use 1–${max} characters.`);
  return value.trim();
}
function hex(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(path, 'use a six-digit hex color or null.');
  return value.toLowerCase();
}
function appearance(value, path, fallback) {
  try { return iconAppearance({ icon: value.icon === undefined ? fallback : value.icon, iconColor: value.iconColor }, fallback === null); }
  catch (error) { fail(path, error.message); }
}
function boolean(value, path, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(path, 'expected true or false.');
  return value;
}

// The public interchange format is independent of Chrome IDs and our storage layout.
export function normalizeImport(document) {
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(document)).length; }
  catch { throw new Error('Choose a valid JSON document.'); }
  if (bytes > MAX_TRANSFER_BYTES) throw new Error('Import files must be 5 MiB or smaller.');
  object(document, 'File', ['format', 'version', 'exportedAt', 'spaces', 'favorites', 'settings']);
  if (document.format !== TRANSFER_FORMAT) fail('File', 'expected format “arclet”. See the format guide.');
  if (document.version !== TRANSFER_VERSION) fail('File', 'only Arclet format version 1 is supported.');
  if (!Object.hasOwn(document, 'spaces') && !Object.hasOwn(document, 'favorites')) fail('File', 'include spaces or favorites.');
  if (document.exportedAt !== undefined && (typeof document.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(document.exportedAt) || !Number.isFinite(Date.parse(document.exportedAt)))) {
    fail('exportedAt', 'expected an ISO date string.');
  }
  let records = 0;
  const count = () => { if (++records > MAX_RECORDS) throw new Error('Import files may contain at most 10,000 spaces, folders, and pages combined.'); };
  function page(value, path, pin = false) {
    count();
    object(value, path, pin ? [...PAGE_FIELDS, 'type'] : PAGE_FIELDS);
    if (pin && value.type !== 'pin') fail(path, 'expected type “pin”.');
    let url;
    try { url = safeSavedUrl(text(value.url, `${path}.url`, 8192)); }
    catch (error) { fail(`${path}.url`, error.message); }
    return { ...(pin ? { type: 'pin' } : {}), url, title: text(value.title, `${path}.title`, 200, pageLabel(url)), ...appearance(value, path, null) };
  }
  function unique(value, seen, path, label) {
    if (seen.has(value)) fail(path, `duplicate ${label} in this file.`);
    seen.add(value);
  }
  const favoriteUrls = new Set();
  const favorites = list(document.favorites, 'favorites').map((value, index) => {
    const path = `favorites[${index}]`;
    const result = page(value, path);
    unique(result.url, favoriteUrls, path, 'favorite URL');
    return result;
  });
  const names = new Set();
  const spaces = list(document.spaces, 'spaces').map((value, index) => {
    count();
    const path = `spaces[${index}]`;
    object(value, path, ['name', 'color', 'backgroundColor', 'icon', 'iconColor', 'items']);
    const name = text(value.name, `${path}.name`, 32);
    unique(name, names, path, 'space name');
    const color = value.color === undefined ? DEFAULT_SPACE_COLOR : value.color;
    if (!Object.hasOwn(COLORS, color)) fail(`${path}.color`, 'choose iris, sage, sand, rose, ocean, or slate.');
    const urls = new Set();
    const folders = new Set();
    function pin(value, itemPath) {
      const result = page(value, itemPath, true);
      unique(result.url, urls, itemPath, 'pinned URL in the space');
      return result;
    }
    const items = list(value.items, `${path}.items`).map((item, itemIndex) => {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (item?.type === 'pin') return pin(item, itemPath);
      count();
      object(item, itemPath, ['type', 'name', 'icon', 'iconColor', 'collapsed', 'items']);
      if (item.type !== 'folder') fail(itemPath, 'expected type “pin” or “folder”.');
      const folderName = text(item.name, `${itemPath}.name`, 64);
      unique(folderName, folders, itemPath, 'folder name');
      return { type: 'folder', name: folderName, ...appearance(item, itemPath, 'folder'),
        collapsed: boolean(item.collapsed, `${itemPath}.collapsed`, false),
        items: list(item.items, `${itemPath}.items`).map((child, childIndex) => pin(child, `${itemPath}.items[${childIndex}]`)) };
    });
    return { name, color, backgroundColor: hex(value.backgroundColor, `${path}.backgroundColor`), ...appearance(value, path, 'sun'), items };
  });
  if (spaces.length > 12) throw new Error('Arclet supports at most 12 spaces.');
  let settings;
  if (document.settings !== undefined) {
    const value = object(document.settings, 'settings', SETTINGS);
    settings = {};
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (key === 'theme' && !['system', 'light', 'dark'].includes(entry)) fail(`settings.${key}`, 'choose system, light, or dark.');
      if (key === 'pageControlsPosition' && !['left', 'right'].includes(entry)) fail(`settings.${key}`, 'choose left or right.');
      if (key === 'favoritesPerRow' && (!Number.isInteger(entry) || entry < 1 || entry > MAX_FAVORITES_PER_ROW)) fail(`settings.${key}`, 'choose an integer from 1 to 8.');
      if (key === 'fontScale' && !FONT_SCALES.includes(entry)) fail(`settings.${key}`, 'choose 90, 100, 110, 125, or 150.');
      if ((key === 'showSearchBar' || key === 'showFavoriteLabels') && typeof entry !== 'boolean') fail(`settings.${key}`, 'expected true or false.');
      settings[key] = key === 'backgroundColor' ? hex(entry, `settings.${key}`) : entry;
    }
  }
  return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, favorites, spaces, ...(settings ? { settings } : {}) };
}

export function exportData(data, now = new Date()) {
  const page = item => ({ title: item.title, url: item.url, icon: item.icon ?? null, iconColor: item.iconColor ?? null });
  const spaceNames = new Set();
  function uniqueName(name, used, max) {
    let candidate = name;
    for (let index = 2; used.has(candidate); index++) {
      const suffix = ` (${index})`;
      candidate = name.slice(0, max - suffix.length).trimEnd() + suffix;
    }
    used.add(candidate);
    return candidate;
  }
  const document = {
    format: TRANSFER_FORMAT, version: TRANSFER_VERSION,
    favorites: data.favorites.map(page),
    spaces: data.spaces.map(space => {
      const folderNames = new Set();
      return { name: uniqueName(space.name, spaceNames, 32), color: space.color,
      backgroundColor: space.backgroundColor ?? null, icon: space.icon, iconColor: space.iconColor ?? null,
      items: pinnedEntries(data, space.id).map(({ kind, item }) => kind === 'pin'
        ? { type: 'pin', ...page(item) }
        : { type: 'folder', name: uniqueName(item.name, folderNames, 64), icon: item.icon, iconColor: item.iconColor ?? null, collapsed: item.collapsed ?? false,
          items: pinnedEntries(data, space.id, item.id).map(({ item }) => ({ type: 'pin', ...page(item) })) }) };
    }),
    settings: Object.fromEntries(SETTINGS.map(key => [key, data[key] ?? defaultData()[key]]))
  };
  return { ...normalizeImport(document), exportedAt: now.toISOString() };
}

export async function importToken(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Build the complete merged result before the controller makes a single storage write.
export function planImport(existing, document, applySettings = false) {
  if (typeof applySettings !== 'boolean') throw new Error('Choose whether to import appearance settings.');
  const incoming = normalizeImport(document);
  const data = structuredClone(existing);
  normalizePinnedOrder(data);
  const summary = { newSpaces: 0, mergedSpaces: 0, folders: 0, pins: 0, favorites: 0, skippedPages: 0, spaceNames: incoming.spaces.map(space => space.name), hasSettings: !!incoming.settings };
  for (const source of incoming.spaces) {
    const matches = data.spaces.filter(space => space.name === source.name);
    if (matches.length > 1) throw new Error(`More than one existing space is named “${source.name}”. Rename one before importing.`);
    let space = matches[0];
    if (space) summary.mergedSpaces++;
    else {
      if (data.spaces.length >= 12) throw new Error('This import would exceed the 12-space limit. Remove or rename spaces before importing.');
      const { items, ...properties } = source;
      space = { ...properties, id: crypto.randomUUID() };
      data.spaces.push(space);
      summary.newSpaces++;
    }
    const urls = new Set(data.pins.filter(pin => pin.spaceId === space.id).map(pin => pin.url));
    let rootOrder = pinnedEntries(data, space.id).length;
    function addPin(source, folderId, order) {
      if (urls.has(source.url)) { summary.skippedPages++; return false; }
      const { type, ...properties } = source;
      data.pins.push({ ...properties, id: crypto.randomUUID(), spaceId: space.id, ...(folderId ? { folderId } : {}), order });
      urls.add(source.url);
      summary.pins++;
      return true;
    }
    for (const item of source.items) {
      if (item.type === 'pin') { if (addPin(item, null, rootOrder)) rootOrder++; continue; }
      const matches = data.folders.filter(folder => folder.spaceId === space.id && folder.name === item.name);
      if (matches.length > 1) throw new Error(`More than one folder is named “${item.name}” in “${space.name}”. Rename one before importing.`);
      let folder = matches[0];
      if (!folder) {
        const { type, items, ...properties } = item;
        folder = { ...properties, id: crypto.randomUUID(), spaceId: space.id, order: rootOrder++ };
        data.folders.push(folder);
        summary.folders++;
      }
      let order = pinnedEntries(data, space.id, folder.id).length;
      for (const pin of item.items) if (addPin(pin, folder.id, order)) order++;
    }
  }
  const urls = new Set(data.favorites.map(page => page.url));
  for (const page of incoming.favorites) {
    if (urls.has(page.url)) { summary.skippedPages++; continue; }
    data.favorites.push({ ...page, id: crypto.randomUUID() });
    urls.add(page.url);
    summary.favorites++;
  }
  if (applySettings && incoming.settings) Object.assign(data, incoming.settings);
  normalizePinnedOrder(data);
  return { data, summary };
}

import { CONTROL_FAVORITES } from './home-page.js';
import { normalizeStoredData } from './stored-data.js';

export const SYNC_LIMIT = 80 * 1024;
export const SYNC_WARNING = .8;
export const SYNC_PREFIX = 'arclet.sync.';
export const SYNC_HEAD = `${SYNC_PREFIX}head`;
const PART_LIMIT = 7000;
const PART_SLOTS = 20;
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const SETTINGS = ['theme', 'backgroundColor', 'showSearchBar', 'pageControlsPosition', 'showFavoriteLabels', 'favoritesPerRow', 'fontScale'];
const PIN_FIELDS = ['id', 'spaceId', 'folderId', 'title', 'url', 'icon', 'iconColor', 'order'];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key] ?? null]));
const bytes = text => new TextEncoder().encode(text).length;
export const storageBytes = entries => Object.entries(entries).reduce((sum, [key, value]) => sum + bytes(key) + bytes(JSON.stringify(value)), 0);
export const canonical = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);

// Explicit allowlist: no live tabs, recovery addresses, ownership, credentials,
// device preferences, unknown legacy fields, or generated icon SVGs leave local storage.
export function syncData(data) {
  return {
    version: 1, ...pick(data, SETTINGS),
    ...(data.showUrlBar === false ? { showUrlBar: false } : {}),
    ...Object.fromEntries(CONTROL_FAVORITES.flatMap(item => [
      ...(data[item.urlKey] ? [[item.urlKey, data[item.urlKey]]] : []),
      ...(data[item.titleKey] && data[item.titleKey] !== item.title ? [[item.titleKey, data[item.titleKey]]] : [])
    ])),
    spaces: data.spaces.map(item => pick(item, ['id', 'name', 'color', 'backgroundColor', 'icon', 'iconColor'])),
    folders: data.folders.map(item => pick(item, ['id', 'spaceId', 'name', 'icon', 'iconColor', 'collapsed', 'order'])),
    favorites: data.favorites.map(item => pick(item, ['id', 'title', 'url', 'icon', 'iconColor'])),
    pins: data.pins.map(item => pick(item, PIN_FIELDS))
  };
}

export async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : canonical(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function partsFor(data) {
  const text = JSON.stringify(syncData(data));
  const parts = [];
  // Chunk the escaped JSON representation, not just raw character count. Even
  // quotes, emoji and long saved URLs stay below Chrome's 8 KiB per-key quota.
  let chunk = '';
  let size = 2;
  for (const char of text) {
    const code = char.codePointAt(0);
    const next = char === '\\' || char === '"' || [8, 9, 10, 12, 13].includes(code) ? 2
      : code < 32 || (code >= 0xd800 && code <= 0xdfff) ? 6 : code < 128 ? 1 : code < 2048 ? 2 : code <= 65535 ? 3 : 4;
    if (size + next > PART_LIMIT) { parts.push(chunk); chunk = ''; size = 2; }
    chunk += char;
    size += next;
  }
  if (chunk) parts.push(chunk);
  return parts;
}

export function packSync(data, head = {}) {
  const parts = partsFor(data);
  return {
    ...Object.fromEntries(Array.from({ length: Math.max(PART_SLOTS, parts.length) }, (_, index) => [`${SYNC_PREFIX}part.${index}`, parts[index] ?? ''])),
    [SYNC_HEAD]: { version: 2, revision: PLACEHOLDER, parent: PLACEHOLDER, device: PLACEHOLDER,
      updatedAt: '2000-01-01T00:00:00.000Z', hash: '0'.repeat(64), ...head, parts: parts.length }
  };
}

export async function readSync(entries) {
  const head = entries[SYNC_HEAD];
  if (!head) return null;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  if (![1, 2].includes(head.version) || !uuid(head.revision) || !uuid(head.device) || (head.parent !== null && !uuid(head.parent)) ||
      typeof head.updatedAt !== 'string' || !Number.isFinite(Date.parse(head.updatedAt)) ||
      !Number.isInteger(head.parts) || head.parts < 1 || head.parts > 20 || !/^[0-9a-f]{64}$/.test(head.hash)) {
    throw new Error('The Chrome Sync configuration is not supported. Your local configuration is unchanged.');
  }
  const parts = Array.from({ length: head.parts }, (_, index) => entries[`${SYNC_PREFIX}part.${index}`]);
  if (parts.some(part => typeof part !== 'string')) return { incomplete: true, head };
  const text = parts.join('');
  if (await fingerprint(text) !== head.hash) return { incomplete: true, head };
  const used = storageBytes(Object.fromEntries(Object.entries(entries).filter(([key]) => key === SYNC_HEAD ||
    Array.from({ length: PART_SLOTS }, (_, index) => `${SYNC_PREFIX}part.${index}`).includes(key))));
  if (used > SYNC_LIMIT) throw new Error('The Chrome configuration exceeds the 80 KB Sync limit. Your local configuration is unchanged.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('Chrome Sync contains an invalid configuration. Your local configuration is unchanged.'); }
  const data = normalizeStoredData(raw);
  if (canonical(syncData(data)) !== canonical(raw)) throw new Error('Chrome Sync contains an invalid configuration. Your local configuration is unchanged.');
  return { head, data, used };
}

// Exact chunked size near the limit. Far beyond it the exact figure cannot change
// the answer, and chunking a multi-megabyte layout character by character is slow,
// so use the escaped document size: a lower bound that omits only per-key overhead.
function measure(data, document = JSON.stringify(syncData(data))) {
  const lowerBound = bytes(JSON.stringify(document));
  return lowerBound > SYNC_LIMIT * 2 ? lowerBound : storageBytes(packSync(data));
}

let cachedAssessment;
export function assessSync(data) {
  // Runs for every sidebar state read, so keep the cache key cheap: no key sorting.
  const document = JSON.stringify(syncData(data));
  if (cachedAssessment?.document === document) return cachedAssessment.result;
  const used = measure(data, document);
  const result = { used, limit: SYNC_LIMIT, ratio: used / SYNC_LIMIT, fits: used <= SYNC_LIMIT,
    removePins: 0, pinsAloneEnough: true, counts: { spaces: data.spaces.length, folders: data.folders.length,
      pins: data.pins.length, favorites: data.favorites.length } };
  if (!result.fits) Object.assign(result, pinAdvice(data, used));
  cachedAssessment = { document, result };
  return result;
}

// How many of the longest pins to remove. Each pin's stored cost is its JSON as
// escaped inside a part string, plus a separator. Removing pins never adds part
// overhead, so the running total is an upper-bound estimate; one re-pack confirms
// it (re-packing for every step of a search is slow on large layouts).
function pinAdvice(data, used) {
  const sizeAfter = removed => measure({ ...data, pins: data.pins.filter(pin => !removed.has(pin.id)) });
  if (sizeAfter(new Set(data.pins.map(pin => pin.id))) > SYNC_LIMIT) return { pinsAloneEnough: false };
  const sorted = data.pins.map(pin => ({ id: pin.id, cost: bytes(JSON.stringify(JSON.stringify(pick(pin, PIN_FIELDS)))) - 1 }))
    .sort((a, b) => b.cost - a.cost);
  let count = 0;
  for (let freed = 0; count < sorted.length && used - freed > SYNC_LIMIT; count++) freed += sorted[count].cost;
  // Confirm, widening the step if the estimate fell short.
  for (let step = 1; count < sorted.length && sizeAfter(new Set(sorted.slice(0, count).map(pin => pin.id))) > SYNC_LIMIT; step *= 2) {
    count = Math.min(sorted.length, count + step);
  }
  return { removePins: count };
}

export function capacityMessage(assessment) {
  if (assessment.fits) return 'Your configuration fits within the 80 KB Sync limit.';
  const remove = assessment.pinsAloneEnough
    ? `Remove about ${assessment.removePins} pinned ${assessment.removePins === 1 ? 'URL' : 'URLs'}, starting with the longest addresses, to fit.`
    : 'Removing pinned URLs alone is not enough. Reduce favorites or folders too.';
  return `This configuration exceeds the 80 KB Sync limit. ${remove} Everything remains local. If Sync is on, explicitly disable it in Settings → Sync before saving a larger configuration.`;
}

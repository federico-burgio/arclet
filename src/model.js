import { hasIcon } from './icons.js';

export const COLORS = {
  iris: { label: 'Iris', light: '#e3ddf1', dark: '#302b40', accent: '#74619e', darkAccent: '#b5a0d4' },
  sage: { label: 'Sage', light: '#dce7df', dark: '#28382f', accent: '#49765e', darkAccent: '#8cbaa0' },
  sand: { label: 'Sand', light: '#eee1cf', dark: '#3d3329', accent: '#956b3e', darkAccent: '#cfaa7b' },
  rose: { label: 'Rose', light: '#f0dce0', dark: '#402c34', accent: '#a35973', darkAccent: '#d99ab0' },
  ocean: { label: 'Ocean', light: '#dce6f1', dark: '#293546', accent: '#4c74a1', darkAccent: '#91b4dc' },
  slate: { label: 'Slate', light: '#e0e2e5', dark: '#303338', accent: '#667180', darkAccent: '#acb7c6' }
};

export const DEFAULT_SPACE_COLOR = 'slate';

export function defaultData() {
  return {
    version: 1,
    spaces: [
      { id: 'personal', name: 'Personal', color: DEFAULT_SPACE_COLOR, icon: 'sun' },
      { id: 'work', name: 'Work', color: DEFAULT_SPACE_COLOR, icon: 'briefcase' }
    ],
    favorites: [],
    pins: [],
    folders: [],
    theme: 'system',
    showSearchBar: true,
    showFavoriteLabels: true
  };
}

export function iconAppearance(payload, optional = false) {
  const name = payload.icon ?? null;
  if (!(optional && name === null) && !hasIcon(name)) throw new Error('Choose an icon from the library.');
  const color = payload.iconColor ?? null;
  if (color !== null && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('Choose a valid icon color.');
  }
  return { icon: name, iconColor: name ? color?.toLowerCase() ?? null : null };
}

export function safeSavedUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https pages can be saved.');
  }
  return url.href;
}

export function destination(value) {
  const input = value.trim();
  if (!input) return 'chrome://newtab/';
  if (/^(https?:\/\/|chrome:\/\/)/i.test(input)) {
    const url = new URL(input);
    if (!url.hostname) throw new Error('Enter a valid address.');
    return url.href;
  }
  // Never turn javascript:, data:, file:, or extension URLs into executable navigation.
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^localhost:\d+(\/|$)/i.test(input)) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }
  if (!/\s/.test(input) && /^(localhost(?::\d+)?|(?:[a-z\d-]+\.)+[a-z\d-]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(input)) {
    return new URL(`${/^localhost(?=[:/]|$)/i.test(input) ? 'http' : 'https'}://${input}`).href;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

export function pageLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || 'New tab'; }
  catch { return 'New tab'; }
}

export function matchingTabs(tabs, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return tabs.filter(tab => terms.every(term => `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(term)));
}

export function openTabsForSpace(tabs, pins, spaceId, favorites = []) {
  const savedUrls = new Set([...pins.filter(page => page.spaceId === spaceId), ...favorites].map(page => page.url));
  return tabs.filter(tab => tab.spaceId === spaceId && !savedUrls.has(tab.url || tab.pendingUrl))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

import { icon } from './icons.js';
import { connect } from './platform.js';
import { MAX_TRANSFER_BYTES } from './transfer.js';

const $ = selector => document.querySelector(selector);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let platform;
let state;
let revision = 0;
let refreshTimer;
let importDraft;
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
$('#settings-shortcut').textContent = $('#help-search-shortcut').textContent = isMac ? '⌘ K' : 'Ctrl K';
$('#panel-shortcut').textContent = isMac ? '⌘ ⇧ E' : 'Ctrl Shift E';
document.querySelectorAll('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)));
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => $(`#${node.dataset.close}`).close()));

const tabs = [...document.querySelectorAll('[role="tab"]')];
function showSection() {
  const section = location.hash.slice(1);
  const selected = tabs.find(tab => tab.getAttribute('aria-controls') === section) ?? tabs[0];
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
  document.title = `${selected.textContent.trim()} — Arclet settings`;
}
tabs.forEach(tab => {
  tab.addEventListener('click', () => { location.hash = tab.getAttribute('aria-controls'); });
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = { ArrowDown: (index + 1) % tabs.length, ArrowUp: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].click();
    tabs[next].focus();
  });
});
window.addEventListener('hashchange', showSection);
showSection();

function toast(message, error = false) {
  if (error) {
    $('#settings-error').textContent = message;
    $('#settings-error').hidden = false;
  } else $('#save-status-text').textContent = message;
}
function applyTheme() {
  if (!state) return;
  const mode = state.theme === 'system' ? (darkMode.matches ? 'dark' : 'light') : state.theme;
  document.documentElement.dataset.mode = mode;
  document.querySelector('meta[name="theme-color"]').content = mode === 'dark' ? '#1b1e23' : '#eceef0';
  document.querySelectorAll('[data-theme]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.theme === state.theme)));
  $('#custom-background').checked = Boolean(state.backgroundColor);
  $('#background-controls').hidden = !state.backgroundColor;
  $('#background-color').value = state.backgroundColor ?? (mode === 'dark' ? '#1b1e23' : '#eceef0');
  if (document.activeElement !== $('#background-hex')) {
    $('#background-hex').value = $('#background-color').value;
    $('#background-hex').setCustomValidity('');
  }
}
function applyState(next) {
  state = next;
  document.documentElement.style.setProperty('--font-scale', state.fontScale / 100);
  applyTheme();
  $('#show-search-bar').checked = state.showSearchBar;
  $('#show-favorite-labels').checked = state.showFavoriteLabels;
  $('#favorites-per-row').value = String(state.favoritesPerRow);
  $('#font-size').value = String(state.fontScale);
}
async function refresh() {
  const ticket = ++revision;
  try {
    const next = await platform.request('GET_STATE');
    if (ticket === revision) applyState(next);
  } catch (error) { toast(error.message, true); }
}
async function command(type, payload) {
  const ticket = ++revision;
  $('#settings-error').hidden = true;
  $('#save-status-text').textContent = 'Saving…';
  try {
    const next = await platform.request(type, payload);
    if (ticket === revision) applyState(next);
    toast('All changes saved');
    return true;
  } catch (error) {
    $('#save-status-text').textContent = 'Could not save this change';
    toast(error.message, true);
    return false;
  }
}
darkMode.addEventListener('change', applyTheme);

$('#choose-import').addEventListener('click', () => {
  $('#import-file').value = '';
  $('#import-file').click();
});
$('#import-file').addEventListener('change', async event => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  const chooser = $('#choose-import');
  chooser.disabled = true;
  importDraft = null;
  $('#transfer-error').hidden = true;
  try {
    if (file.size > MAX_TRANSFER_BYTES) throw new Error('Import files must be 5 MiB or smaller.');
    let document;
    try { document = JSON.parse(await file.text()); }
    catch { throw new Error('This file is not valid JSON. See the format guide for an example.'); }
    const { importPreview: preview } = await platform.request('PREVIEW_IMPORT', { document });
    importDraft = { document, token: preview.token };
    $('#import-filename').textContent = file.name;
    const count = (value, singular, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
    const lines = [
      `${count(preview.newSpaces, 'new space')} · ${count(preview.mergedSpaces, 'existing space')} merged`,
      `${count(preview.favorites, 'new favorite')} · ${count(preview.pins, 'new pinned page')} · ${count(preview.folders, 'new folder')}`,
      `${count(preview.skippedPages, 'existing URL')} skipped`,
      preview.spaceNames.length ? `Spaces: ${preview.spaceNames.join(', ')}` : 'No spaces in this file.'
    ];
    $('#import-summary').replaceChildren(...lines.map(line => make('p', '', line)));
    $('#import-settings').checked = false;
    $('#import-settings').disabled = !preview.hasSettings;
    $('#import-error').hidden = true;
    $('#confirm-import').disabled = false;
    $('#import-dialog').showModal();
  } catch (error) {
    $('#transfer-error').textContent = error.message;
    $('#transfer-error').hidden = false;
  }
  finally { chooser.disabled = false; }
});
$('#confirm-import').addEventListener('click', async () => {
  if (!importDraft) return;
  const confirm = $('#confirm-import');
  confirm.disabled = true;
  try {
    const ticket = ++revision;
    const next = await platform.request('IMPORT_DATA', { ...importDraft, applySettings: $('#import-settings').checked });
    if (ticket === revision) applyState(next);
    importDraft = null;
    $('#import-dialog').close();
    toast('Import complete.');
  } catch (error) {
    $('#import-error').textContent = error.message;
    $('#import-error').hidden = false;
    // A new preview is required after an error or any concurrent data changes.
  }
});
$('#import-dialog').addEventListener('close', () => { importDraft = null; });
$('#export-data').addEventListener('click', async () => {
  const exportButton = $('#export-data');
  exportButton.disabled = true;
  $('#transfer-error').hidden = true;
  try {
    const { exportDocument } = await platform.request('EXPORT_DATA');
    const blob = new Blob([`${JSON.stringify(exportDocument, null, 2)}\n`], { type: 'application/json' });
    if (blob.size > MAX_TRANSFER_BYTES) throw new Error('This export exceeds the 5 MiB import limit. Reduce saved pages before exporting.');
    const url = URL.createObjectURL(blob);
    const link = make('a');
    link.href = url;
    link.download = `arclet-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Export downloaded.');
  } catch (error) {
    $('#transfer-error').textContent = error.message;
    $('#transfer-error').hidden = false;
  }
  finally { exportButton.disabled = false; }
});
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
  $('#preview-note').hidden = !platform.demo;
  const version = globalThis.chrome?.runtime?.getManifest?.().version;
  if (version) {
    document.querySelectorAll('[data-version]').forEach(node => { node.textContent = `Arclet ${version}`; });
    document.querySelectorAll('[data-version-number]').forEach(node => { node.textContent = version; });
  }
  platform.subscribe(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 70);
  });
  await refresh();
  if (state) $('#save-status-text').textContent = 'Changes save automatically';
} catch (error) { toast(error.message, true); }

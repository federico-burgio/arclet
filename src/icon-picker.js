import { ICON_NAMES, icon } from './icons.js';
import { ICON_TAGS } from './icon-catalog.js';

const $ = selector => document.querySelector(selector);
const label = name => name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const swatches = { Slate: '#667180', Purple: '#8b68c0', Blue: '#477fc1', Teal: '#278a8b', Green: '#54855d', Gold: '#aa7c24', Orange: '#bf713b', Rose: '#bb5e82', Red: '#c35e5e' };
const common = ['folder', 'sun', 'briefcase', 'house', 'star', 'heart', 'bookmark', 'book-open', 'coffee', 'leaf', 'globe', 'music', 'headphones', 'camera', 'code', 'terminal', 'palette', 'lightbulb', 'rocket', 'sparkles', 'flask-conical', 'mountain', 'plane', 'gamepad-2'];
const names = [...common, ...ICON_NAMES.filter(name => !common.includes(name))];
let draft;
let save;
let limit;

function choice(title, action) {
  const node = document.createElement('button');
  node.type = 'button';
  node.title = title;
  node.setAttribute('aria-label', title);
  node.addEventListener('click', action);
  return node;
}

function renderPreview() {
  const preview = $('#icon-preview');
  const glyph = icon(draft.icon ?? 'globe', draft.iconColor);
  const caption = document.createElement('span');
  caption.textContent = draft.icon ? label(draft.icon) : 'Site icon';
  preview.replaceChildren(glyph, caption);
  $('#use-site-icon').setAttribute('aria-pressed', String(!draft.icon));
  $('#icon-custom-color').value = draft.iconColor ?? '#667180';
  $('.icon-colors').disabled = !draft.icon;
  for (const node of $('#icon-colors').children) node.setAttribute('aria-pressed', String((node.dataset.color || null) === draft.iconColor));
  for (const node of $('#icon-grid').children) {
    node.setAttribute('aria-pressed', String(node.dataset.iconName === draft.icon));
    node.style.color = draft.iconColor ?? '';
  }
}

function renderResults() {
  const terms = $('#icon-search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = names.filter(name => terms.every(term => `${name.replaceAll('-', ' ')} ${(ICON_TAGS[name] ?? []).join(' ')}`.includes(term)));
  const grid = $('#icon-grid');
  grid.replaceChildren(...matches.slice(0, limit).map(name => {
    const node = choice(label(name), () => { draft.icon = name; renderPreview(); });
    node.dataset.iconName = name;
    node.append(icon(name));
    return node;
  }));
  $('#icon-result-count').textContent = matches.length ? `${matches.length.toLocaleString()} icons · showing ${Math.min(limit, matches.length)}` : 'No icons found. Try another word.';
  $('#more-icons').hidden = matches.length <= limit;
  renderPreview();
}

export function openIconPicker({ appearance, optional = false, title = 'Choose an icon', onApply }) {
  draft = { icon: appearance.icon ?? (optional ? null : 'folder'), iconColor: appearance.iconColor ?? null };
  save = onApply;
  limit = 96;
  $('#icon-dialog-title').textContent = title;
  $('#icon-library-note').textContent = `${ICON_NAMES.length.toLocaleString()} Lucide outline icons. Choose a shape and a color.`;
  $('#use-site-icon').hidden = !optional;
  $('#icon-search').value = '';
  const colors = $('#icon-colors');
  colors.replaceChildren();
  const automatic = choice('Automatic color', () => { draft.iconColor = null; renderPreview(); });
  automatic.textContent = 'Auto';
  automatic.className = 'color-option automatic-color';
  colors.append(automatic);
  for (const [name, color] of Object.entries(swatches)) {
    const node = choice(name, () => { draft.iconColor = color; renderPreview(); });
    node.className = 'color-option';
    node.dataset.color = color;
    node.style.background = color;
    colors.append(node);
  }
  renderResults();
  $('#icon-grid').scrollTop = 0;
  $('#icon-dialog').showModal();
  $('#icon-search').focus();
}

$('#icon-search').addEventListener('input', () => { limit = 96; renderResults(); $('#icon-grid').scrollTop = 0; });
$('#more-icons').addEventListener('click', () => { limit += 96; renderResults(); });
$('#use-site-icon').addEventListener('click', () => { draft = { icon: null, iconColor: null }; renderPreview(); });
$('#icon-custom-color').addEventListener('input', event => { draft.iconColor = event.target.value; renderPreview(); });
$('#apply-icon').addEventListener('click', async () => {
  const node = $('#apply-icon');
  node.disabled = true;
  try {
    if (await save({ ...draft }) !== false) $('#icon-dialog').close();
  } finally { node.disabled = false; }
});

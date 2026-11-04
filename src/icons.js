import { ICON_NODES } from './icon-catalog.js';

// Keep the original interface names compatible with saved spaces and UI controls.
const aliases = { close: 'x', more: 'ellipsis', chevronDown: 'chevron-down', sliders: 'sliders-horizontal',
  volume: 'volume-2', muted: 'volume-x', arrow: 'arrow-right', edit: 'pencil' };
export const ICON_NAMES = Object.keys(ICON_NODES);
export const hasIcon = name => typeof name === 'string' && Object.hasOwn(ICON_NODES, aliases[name] ?? name);
export function icon(name, color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  // Shapes and attributes come only from the bundled library, never from saved/user markup.
  for (const [tag, attributes] of ICON_NODES[aliases[name] ?? name] ?? ICON_NODES.globe) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  if (/^#[0-9a-f]{6}$/i.test(color ?? '')) svg.style.color = color;
  return svg;
}

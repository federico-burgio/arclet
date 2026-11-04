import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NODES, ICON_TAGS } from '../src/icon-catalog.js';
import { hasIcon } from '../src/icons.js';

test('the bundled Lucide catalog contains only inert SVG geometry and searchable tags', () => {
  assert.ok(Object.keys(ICON_NODES).length > 2000);
  const tags = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
  const attributes = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'points', 'fill']);
  for (const [name, nodes] of Object.entries(ICON_NODES)) {
    assert.match(name, /^[a-z0-9-]+$/);
    assert.ok(nodes.length);
    for (const [tag, values] of nodes) {
      assert.ok(tags.has(tag), `${name}: unexpected element ${tag}`);
      for (const [key, value] of Object.entries(values)) {
        assert.ok(attributes.has(key), `${name}: unexpected attribute ${key}`);
        assert.equal(typeof value, 'string');
        if (key === 'fill') assert.equal(value, 'currentColor');
      }
    }
    assert.ok(Array.isArray(ICON_TAGS[name]));
  }
  for (const name of ['folder', 'palette', 'sun', 'briefcase', 'globe', 'coffee', 'leaf', 'moon', 'more', 'close', 'chevronDown']) assert.equal(hasIcon(name), true);
  assert.equal(hasIcon('__proto__'), false);
});

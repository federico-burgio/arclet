import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.background.type, 'module');
assert.ok(!manifest.host_permissions?.length, 'No host permissions are needed.');
assert.ok(!manifest.content_scripts, 'Do not inject anything into pages.');
for (const path of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) await access(path);
const html = await readFile(manifest.side_panel.default_path, 'utf8');
assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'Scripts must be external for extension CSP.');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (match[1].startsWith('https://')) continue;
  await access(match[1]);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique.');
for (const directory of ['src', 'scripts', 'tests']) {
  for (const file of await readdir(directory)) {
    if (!/\.(m?js)$/.test(file)) continue;
    assert.equal(spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' }).status, 0, `Invalid JavaScript: ${directory}/${file}`);
  }
}
console.log('Manifest, resources, HTML IDs, CSP, version, and JavaScript syntax checked.');

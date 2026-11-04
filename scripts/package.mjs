import { mkdir, rm, cp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const check = spawnSync(process.execPath, ['scripts/check.mjs'], { stdio: 'inherit' });
if (check.status) process.exit(check.status);
await mkdir('dist', { recursive: true });
await rm('dist/arclet', { recursive: true, force: true });
await mkdir('dist/arclet');
for (const entry of ['manifest.json', 'sidepanel.html', 'options.html', 'src', 'icons', 'docs', 'README.md']) await cp(entry, `dist/arclet/${entry}`, { recursive: true });
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const archive = `arclet-${version}.zip`;
await rm(`dist/${archive}`, { force: true });
const zip = spawnSync('zip', ['-qr', `../${archive}`, '.'], { cwd: 'dist/arclet', stdio: 'inherit' });
if (zip.status) process.exit(zip.status);
console.log(`Load unpacked: dist/arclet\nPackaged: dist/${archive}`);

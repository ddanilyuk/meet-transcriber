// Builds the Chrome Web Store package: dist/meet-transcriber-<version>.zip with the contents of extension/.
// The only difference from the unpacked extension is the manifest: the dev server host permission
// (http://localhost:*) is dropped, because a store install never talks to it. background/dev-reload.js stays,
// since it is a no-op unless chrome.management reports installType === 'development'.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'store');

const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json version ${manifest.version} differs from package.json ${pkg.version}`);
}

manifest.host_permissions = (manifest.host_permissions || []).filter((p) => !/^https?:\/\/localhost[:/]/.test(p));

await rm(STAGE, { recursive: true, force: true });
await mkdir(STAGE, { recursive: true });
await cp(SRC, STAGE, { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });
await writeFile(join(STAGE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zip = join(DIST, `meet-transcriber-${manifest.version}.zip`);
await rm(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: STAGE });
console.log(`${zip}\nhost_permissions: ${manifest.host_permissions.join(', ')}`);

// Writes extension/background/drive-config.js, the Google OAuth client of the Drive copy. The committed file is a
// placeholder with an empty client id (Drive copy hidden), because GitHub push protection refuses commits with a Google
// OAuth client secret. This script fills it in locally and marks it skip-worktree, so git ignores the local values;
// without a secret it writes the placeholder back and clears the mark. The store build writes its own copy.
//
// The secret comes from DRIVE_CLIENT_SECRET (GitHub Actions secret of the same name) or, when unset, from the macOS
// Keychain item service `meet-transcriber-drive`, account `client-secret`. Without a secret the file gets an empty
// client id, which hides the Drive copy everywhere; `--require` fails instead (the store build uses it).
//
//   node scripts/drive-config.mjs [--require]
//
// The secret is not confidential once the extension ships: it is in the public store package, like the secret of any
// installed app. Google refuses the code exchange of a "Web application" client without it, even with PKCE.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DRIVE_CLIENT_ID = '512825143970-po1i99s1ttriij5kkmu8st4lh9akmhoh.apps.googleusercontent.com';
export const KEYCHAIN_SERVICE = 'meet-transcriber-drive';
export const KEYCHAIN_ACCOUNT = 'client-secret';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DRIVE_CONFIG_PATH = join(ROOT, 'extension', 'background', 'drive-config.js');

export function readDriveSecret() {
  if (process.env.DRIVE_CLIENT_SECRET) return process.env.DRIVE_CLIENT_SECRET;
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function driveConfigSource(secret) {
  const id = secret ? DRIVE_CLIENT_ID : '';
  return `// Written by scripts/drive-config.mjs (npm run config); commit only the empty placeholder.
// Google OAuth client of the extension ("Web application" type, redirect URIs https://<extension id>.chromiumapp.org/
// for the store id and the unpacked dev id). With an empty clientId the Google Drive copy is hidden everywhere.
export const DRIVE_CONFIG = {
  clientId: ${JSON.stringify(id)},
  clientSecret: ${JSON.stringify(secret || '')},
};
`;
}

export async function writeDriveConfig(path, { require = false } = {}) {
  const secret = readDriveSecret();
  if (!secret && require) {
    throw new Error(
      `No Drive client secret: set DRIVE_CLIENT_SECRET or add the Keychain item ` +
        `(security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w)`,
    );
  }
  await writeFile(path, driveConfigSource(secret));
  return Boolean(secret);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ok = await writeDriveConfig(DRIVE_CONFIG_PATH, { require: process.argv.includes('--require') });
    try {
      execFileSync('git', ['update-index', ok ? '--skip-worktree' : '--no-skip-worktree', DRIVE_CONFIG_PATH], {
        cwd: ROOT,
        stdio: 'ignore',
      });
    } catch {
      // Not a git checkout (e.g. a release archive): nothing to hide.
    }
    console.log(ok ? `${DRIVE_CONFIG_PATH}: Drive client configured` : `${DRIVE_CONFIG_PATH}: no secret, Drive copy hidden`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

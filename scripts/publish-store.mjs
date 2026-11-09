// Publishes the extension to the Chrome Web Store through the Chrome Web Store API V2, without npm dependencies.
//
//   npm run store:auth      one-time: OAuth sign-in, saves the credentials in the macOS Keychain
//   npm run store:status    published and submitted versions
//   npm run store:publish   builds dist/meet-transcriber-<version>.zip, uploads it and submits it for review
//                           (--upload-only: upload without submitting; --yes: skip the confirmation)
//
// Credentials come from environment variables (CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN,
// CWS_PUBLISHER_ID) or, when unset, from Keychain items of the service `meet-transcriber-cws`. Setup steps are in
// store/README.md. API reference: https://developer.chrome.com/docs/webstore/api/reference/rest
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXTENSION_ID = process.env.CWS_EXTENSION_ID || 'nbplddgnafihdhidggcphgcleiamhobk';
// Overridable so the flow can be exercised against a local mock server.
const API_ROOT = process.env.CWS_API_ROOT || 'https://chromewebstore.googleapis.com';
const TOKEN_URL = process.env.CWS_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const KEYCHAIN_SERVICE = 'meet-transcriber-cws';
const UPLOAD_WAIT_MS = Number(process.env.CWS_UPLOAD_WAIT_MS || 120_000);
const POLL_MS = Number(process.env.CWS_POLL_MS || 2000);

const FIELDS = {
  clientId: { env: 'CWS_CLIENT_ID', account: 'client-id', prompt: 'OAuth client ID' },
  clientSecret: { env: 'CWS_CLIENT_SECRET', account: 'client-secret', prompt: 'OAuth client secret' },
  refreshToken: { env: 'CWS_REFRESH_TOKEN', account: 'refresh-token' },
  publisherId: { env: 'CWS_PUBLISHER_ID', account: 'publisher-id', prompt: 'Publisher ID (dashboard → Publisher → Settings)' },
};

class Fail extends Error {}

// ---------- credentials ----------

function keychainGet(account) {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

// `-w <value>` is visible in the process list for the moment the command runs; acceptable for a local
// one-time step. `-U` updates an existing item.
function keychainSet(account, value) {
  execFileSync('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', value], {
    stdio: 'ignore',
  });
}

function credential(key) {
  const field = FIELDS[key];
  return process.env[field.env] || keychainGet(field.account);
}

function credentials() {
  const values = Object.fromEntries(Object.keys(FIELDS).map((key) => [key, credential(key)]));
  const missing = Object.entries(FIELDS).filter(([key]) => !values[key]).map(([, f]) => `${f.env} (Keychain: ${KEYCHAIN_SERVICE} / ${f.account})`);
  if (missing.length) {
    throw new Fail(`Missing credentials:\n  ${missing.join('\n  ')}\nRun \`npm run store:auth\` first (setup: store/README.md).`);
  }
  return values;
}

// ---------- HTTP ----------

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function apiError(what, res, body) {
  const err = body.error;
  const message = typeof err === 'object' ? err.message || err.status : body.error_description || err || body.raw;
  const details = err?.details ? `\n${JSON.stringify(err.details, null, 2)}` : '';
  return new Fail(`${what} failed: HTTP ${res.status} ${message || ''}${details}`);
}

async function accessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await readJson(res);
  if (body.error === 'invalid_grant') {
    throw new Fail('The refresh token was rejected (expired or revoked). Run `npm run store:auth` again.');
  }
  if (!res.ok || !body.access_token) throw apiError('Token refresh', res, body);
  return body.access_token;
}

const itemPath = (publisherId) => `publishers/${publisherId}/items/${EXTENSION_ID}`;

async function api(what, token, method, url, init = {}) {
  const res = await fetch(url, { method, ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  const body = await readJson(res);
  if (!res.ok) throw apiError(what, res, body);
  return body;
}

const fetchStatus = (token, publisherId) =>
  api('fetchStatus', token, 'GET', `${API_ROOT}/v2/${itemPath(publisherId)}:fetchStatus`);

const versionsOf = (revision) => (revision?.distributionChannels || []).map((c) => c.crxVersion).filter(Boolean);

function describe(status) {
  const line = (label, rev) => (rev ? `${label}: ${versionsOf(rev).join(', ') || '—'} (${rev.state})` : `${label}: none`);
  const lines = [line('Published', status.publishedItemRevisionStatus), line('Submitted', status.submittedItemRevisionStatus)];
  if (status.lastAsyncUploadState && status.lastAsyncUploadState !== 'NOT_FOUND') lines.push(`Last upload: ${status.lastAsyncUploadState}`);
  if (status.takenDown) lines.push('TAKEN DOWN for a policy violation');
  if (status.warned) lines.push('WARNED: the item will be taken down unless the policy issue is resolved');
  return lines.join('\n');
}

// Compares dotted Chrome versions (up to four integers).
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const isInProgress = (state) => typeof state === 'string' && state.endsWith('IN_PROGRESS');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- commands ----------

async function status() {
  const creds = credentials();
  const token = await accessToken(creds);
  console.log(describe(await fetchStatus(token, creds.publisherId)));
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes|т|так)$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function publish({ uploadOnly, yes }) {
  const creds = credentials();
  const manifest = JSON.parse(await readFile(join(ROOT, 'extension/manifest.json'), 'utf8'));
  const version = manifest.version;

  // Releases go tag → GitHub release → store; warn when the store would get something else.
  const warnings = [];
  if (git('status', '--porcelain')) warnings.push('the working tree has uncommitted changes');
  if (!git('tag', '--points-at', 'HEAD').split('\n').includes(`v${version}`)) warnings.push(`HEAD is not tagged v${version}`);

  const token = await accessToken(creds);
  const before = await fetchStatus(token, creds.publisherId);
  console.log(describe(before));

  const pending = before.submittedItemRevisionStatus;
  if (pending?.state === 'PENDING_REVIEW') {
    throw new Fail(`Version ${versionsOf(pending).join(', ')} is still in review. Wait for the review, or cancel the submission in the dashboard first.`);
  }
  const known = [...versionsOf(before.publishedItemRevisionStatus), ...versionsOf(pending)];
  const newest = known.sort(compareVersions).at(-1);
  if (newest && compareVersions(version, newest) <= 0) {
    throw new Fail(`manifest.json version ${version} is not greater than ${newest} already in the store. Bump the version first.`);
  }

  for (const w of warnings) console.warn(`Warning: ${w}.`);
  const action = uploadOnly ? 'Upload' : 'Upload and submit for review';
  if (!yes && !(await confirm(`${action} version ${version}?`))) throw new Fail('Cancelled.');

  const zipPath = execFileSync(process.execPath, [join(ROOT, 'scripts/build-store.mjs')], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].trim();
  const zip = await readFile(zipPath);
  console.log(`Uploading ${zipPath} (${Math.round(zip.length / 1024)} KB)…`);

  const upload = await api('Upload', token, 'POST', `${API_ROOT}/upload/v2/${itemPath(creds.publisherId)}:upload`, {
    headers: { 'Content-Type': 'application/zip', 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-File-Name': 'extension.zip' },
    body: zip,
  });
  let state = upload.uploadState;
  const deadline = Date.now() + UPLOAD_WAIT_MS;
  while (isInProgress(state)) {
    if (Date.now() > deadline) throw new Fail('The upload is still processing. Check `npm run store:status` later, then publish from the dashboard.');
    await sleep(POLL_MS);
    state = (await fetchStatus(token, creds.publisherId)).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Fail(`Upload ended with state ${state}.`);
  console.log(`Uploaded version ${upload.crxVersion || version}.`);
  if (uploadOnly) return;

  const res = await api('Publish', token, 'POST', `${API_ROOT}/v2/${itemPath(creds.publisherId)}:publish`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  });
  for (const w of res.warningInfo?.warnings || []) console.warn(`Store warning ${w.reason}: ${w.description}`);
  console.log(`Submitted version ${version}: ${res.state}. It goes live automatically once the review passes.`);
}

// One-time sign-in: OAuth for a "Desktop app" client with a loopback redirect and PKCE. Asks for the client ID,
// secret and publisher ID (prefilled from env/Keychain), checks them with a real fetchStatus call and only then saves
// them in the Keychain.
async function auth() {
  if (process.platform !== 'darwin') throw new Fail('store:auth saves to the macOS Keychain; elsewhere set the CWS_* environment variables.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const values = {};
  try {
    for (const [key, field] of Object.entries(FIELDS)) {
      if (!field.prompt) continue;
      const current = credential(key);
      const hint = current ? ` [${key === 'clientSecret' ? 'saved' : current}]` : '';
      values[key] = (await rl.question(`${field.prompt}${hint}: `)).trim() || current;
      if (!values[key]) throw new Fail(`${field.prompt} is required.`);
    }
  } finally {
    rl.close();
  }

  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: values.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })}`;

  const code = await new Promise((resolveCode, reject) => {
    const timer = setTimeout(() => reject(new Fail('No answer from the browser within 5 minutes.')), 5 * 60_000);
    server.on('request', (req, res) => {
      const params = new URL(req.url, redirectUri).searchParams;
      if (!params.has('code') && !params.has('error')) return res.writeHead(404).end();
      const ok = params.get('state') === state && params.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p style="font:16px system-ui;padding:24px">${ok ? 'Done, you can close this tab.' : 'Sign-in failed, see the terminal.'}</p>`);
      clearTimeout(timer);
      if (ok) resolveCode(params.get('code'));
      else reject(new Fail(`Sign-in failed: ${params.get('error') || 'state mismatch'}`));
    });
    console.log(`Opening the browser. Sign in with the Google account that owns the Chrome Web Store item.\n${url}\n`);
    try {
      execFileSync('open', [url], { stdio: 'ignore' });
    } catch { /* the URL is printed above */ }
  }).finally(() => server.close());

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: values.clientId,
      client_secret: values.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await readJson(res);
  if (!res.ok || !tokens.access_token) throw apiError('Code exchange', res, tokens);
  if (!tokens.refresh_token) throw new Fail('Google returned no refresh token. Revoke the app at https://myaccount.google.com/permissions and run store:auth again.');
  values.refreshToken = tokens.refresh_token;

  console.log(describe(await fetchStatus(tokens.access_token, values.publisherId)));
  for (const [key, field] of Object.entries(FIELDS)) keychainSet(field.account, values[key]);
  console.log(`\nSaved to the Keychain (service ${KEYCHAIN_SERVICE}).`);
}

// ---------- main ----------

const [command, ...flags] = process.argv.slice(2);
const commands = {
  auth,
  status,
  publish: () => publish({ uploadOnly: flags.includes('--upload-only'), yes: flags.includes('--yes') }),
};

if (!commands[command]) {
  console.error('Usage: node scripts/publish-store.mjs auth | status | publish [--upload-only] [--yes]');
  process.exit(2);
}
try {
  await commands[command]();
} catch (err) {
  console.error(err instanceof Fail ? err.message : err);
  process.exit(1);
}

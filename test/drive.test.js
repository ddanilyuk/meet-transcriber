import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, DriveError, DRIVE_FOLDER, DRIVE_MIME } from '../extension/background/drive.js';
import { createDriveAuth, DRIVE_SCOPE } from '../extension/background/drive-auth.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Fake fetch: `routes` is a list of [predicate, responder]; every call is recorded.
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body || '' };
    calls.push(call);
    for (const [match, respond] of routes) if (match(call)) return respond(call);
    throw new Error(`unexpected request ${call.method} ${call.url}`);
  };
  return { fetch, calls };
}

const isFolderGet = (c) => c.method === 'GET' && /\/drive\/v3\/files\/[^?]+\?/.test(c.url);
const isFolderSearch = (c) => c.method === 'GET' && c.url.includes('/drive/v3/files?');
const isFolderCreate = (c) => c.method === 'POST' && c.url.includes('/drive/v3/files?') && !c.url.includes('/upload/');
const isFileCreate = (c) => c.method === 'POST' && c.url.includes('/upload/drive/v3/files?');
const isFilePatch = (c) => c.method === 'PATCH' && c.url.includes('/upload/drive/v3/files/');

const staticAuth = (tokens = ['t1', 't2']) => {
  const asked = [];
  return { asked, getToken: async ({ fresh } = {}) => (asked.push(!!fresh), tokens[fresh ? 1 : 0]) };
};

test('drive: first upload creates the folder and a markdown file inside it', async () => {
  const storage = memoryStorage();
  const { fetch, calls } = fakeFetch([
    [isFolderSearch, () => reply(200, { files: [] })],
    [isFolderCreate, () => reply(200, { id: 'folder-1' })],
    [isFileCreate, () => reply(200, { id: 'file-1' })],
  ]);
  const drive = createDrive({ fetch, auth: staticAuth(), storage });
  const res = await drive.upload({ name: '2026-09-24 14-02 Синк.md', text: '# Синк\n\nПривіт' });
  assert.deepEqual(res, { fileId: 'file-1' });
  assert.equal(storage.data.get('driveFolder'), 'folder-1');
  assert.equal(JSON.parse(calls.find(isFolderCreate).body).name, DRIVE_FOLDER);
  const upload = calls.find(isFileCreate);
  assert.equal(upload.headers.Authorization, 'Bearer t1');
  assert.match(upload.headers['Content-Type'], /^multipart\/related; boundary=/);
  const boundary = upload.headers['Content-Type'].split('boundary=')[1];
  const parts = upload.body.split(`--${boundary}`);
  assert.equal(parts.length, 4, 'two parts and the closing delimiter');
  assert.deepEqual(JSON.parse(parts[1].split('\r\n\r\n')[1]), { name: '2026-09-24 14-02 Синк.md', mimeType: DRIVE_MIME, parents: ['folder-1'] });
  assert.match(parts[2], new RegExp(`Content-Type: ${DRIVE_MIME}`));
  assert.ok(parts[2].includes('# Синк\n\nПривіт'));
  assert.equal(parts[3], '--\r\n');
});

test('drive: an existing folder is found and reused', async () => {
  const storage = memoryStorage();
  const { fetch, calls } = fakeFetch([
    [isFolderSearch, () => reply(200, { files: [{ id: 'folder-9' }] })],
    [isFileCreate, () => reply(200, { id: 'file-1' })],
  ]);
  await createDrive({ fetch, auth: staticAuth(), storage }).upload({ name: 'a.md', text: 'x' });
  assert.equal(storage.data.get('driveFolder'), 'folder-9');
  assert.equal(calls.filter(isFolderCreate).length, 0);
});

test('drive: a known file is updated in place, name included', async () => {
  const { fetch, calls } = fakeFetch([[isFilePatch, () => reply(200, { id: 'file-1' })]]);
  const drive = createDrive({ fetch, auth: staticAuth(), storage: memoryStorage({ driveFolder: 'folder-1' }) });
  assert.deepEqual(await drive.upload({ fileId: 'file-1', name: 'Нова назва.md', text: 'v2' }), { fileId: 'file-1' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('/files/file-1?'));
  assert.ok(calls[0].body.includes('{"name":"Нова назва.md"}'));
  assert.ok(calls[0].body.includes('v2'));
});

test('drive: a copy deleted from Drive is created again', async () => {
  const { fetch, calls } = fakeFetch([
    [isFilePatch, () => reply(404, { error: { message: 'File not found' } })],
    [isFolderGet, () => reply(200, { id: 'folder-1', trashed: false })],
    [isFileCreate, () => reply(200, { id: 'file-2' })],
  ]);
  const drive = createDrive({ fetch, auth: staticAuth(), storage: memoryStorage({ driveFolder: 'folder-1' }) });
  assert.deepEqual(await drive.upload({ fileId: 'file-1', name: 'a.md', text: 'x' }), { fileId: 'file-2' });
  assert.equal(calls.filter(isFileCreate).length, 1);
});

test('drive: a deleted or trashed folder is replaced by a new one', async () => {
  for (const gone of [() => reply(404), () => reply(200, { id: 'folder-1', trashed: true })]) {
    const storage = memoryStorage({ driveFolder: 'folder-1' });
    const { fetch, calls } = fakeFetch([
      [isFolderGet, gone],
      [isFolderSearch, () => reply(200, { files: [] })],
      [isFolderCreate, () => reply(200, { id: 'folder-2' })],
      [isFileCreate, () => reply(200, { id: 'file-1' })],
    ]);
    await createDrive({ fetch, auth: staticAuth(), storage }).upload({ name: 'a.md', text: 'x' });
    assert.equal(storage.data.get('driveFolder'), 'folder-2');
    assert.ok(calls.find(isFileCreate).body.includes('"parents":["folder-2"]'));
  }
});

test('drive: a 401 is retried once with a fresh token', async () => {
  let n = 0;
  const { fetch, calls } = fakeFetch([[isFilePatch, () => (n++ ? reply(200, { id: 'file-1' }) : reply(401))]]);
  const auth = staticAuth();
  const drive = createDrive({ fetch, auth, storage: memoryStorage() });
  await drive.upload({ fileId: 'file-1', name: 'a.md', text: 'x' });
  assert.deepEqual(auth.asked, [false, true]);
  assert.equal(calls[1].headers.Authorization, 'Bearer t2');
});

test('drive: a persistent 401 means the user has to sign in again', async () => {
  const { fetch } = fakeFetch([[isFilePatch, () => reply(401)]]);
  const drive = createDrive({ fetch, auth: staticAuth(), storage: memoryStorage() });
  await assert.rejects(drive.upload({ fileId: 'file-1', name: 'a.md', text: 'x' }), (err) => err instanceof DriveError && err.kind === 'auth');
});

test('drive: network and server failures are reported with their kind', async () => {
  const offline = createDrive({ fetch: async () => { throw new TypeError('Failed to fetch'); }, auth: staticAuth(), storage: memoryStorage() });
  await assert.rejects(offline.upload({ fileId: 'f', name: 'a.md', text: 'x' }), (err) => err.kind === 'network');
  const { fetch } = fakeFetch([[isFilePatch, () => reply(500, { error: { message: 'Backend Error' } })]]);
  const broken = createDrive({ fetch, auth: staticAuth(), storage: memoryStorage() });
  await assert.rejects(broken.upload({ fileId: 'f', name: 'a.md', text: 'x' }), (err) => err.kind === 'http' && err.status === 500 && err.message === 'Backend Error');
});

// ---------- sign-in ----------

function authSetup({ saved = null, routes = [], secret = undefined } = {}) {
  const clock = { t: 1_000_000 };
  const storage = memoryStorage(saved ? { driveAuth: saved } : {});
  const { fetch, calls } = fakeFetch(routes);
  const flows = [];
  const identity = {
    getRedirectURL: () => 'https://abcdef.chromiumapp.org/',
    launchWebAuthFlow: async ({ url, interactive }) => {
      flows.push({ url: new URL(url), interactive });
      return `https://abcdef.chromiumapp.org/?state=${new URL(url).searchParams.get('state')}&code=the-code`;
    },
  };
  const auth = createDriveAuth({ storage, config: { clientId: 'client-1', clientSecret: secret }, fetch, identity, now: () => clock.t });
  return { clock, storage, calls, flows, auth };
}

const isToken = (c) => c.url === 'https://oauth2.googleapis.com/token';
const isAbout = (c) => c.url.includes('/drive/v3/about');

test('auth: connect runs the code + PKCE flow and stores the refresh token', async () => {
  const { auth, flows, calls, storage, clock } = authSetup({
    routes: [
      [isToken, () => reply(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: DRIVE_SCOPE })],
      [isAbout, () => reply(200, { user: { emailAddress: 'me@example.com' } })],
    ],
  });
  assert.deepEqual(await auth.status(), { connected: false, email: null });
  assert.deepEqual(await auth.connect(), { connected: true, email: 'me@example.com' });

  const asked = flows[0].url.searchParams;
  assert.equal(flows[0].interactive, true);
  assert.equal(asked.get('client_id'), 'client-1');
  assert.equal(asked.get('response_type'), 'code');
  assert.equal(asked.get('scope'), DRIVE_SCOPE);
  assert.equal(asked.get('access_type'), 'offline');
  assert.equal(asked.get('prompt'), 'consent');
  assert.equal(asked.get('code_challenge_method'), 'S256');
  assert.equal(asked.get('redirect_uri'), 'https://abcdef.chromiumapp.org/');

  const exchange = new URLSearchParams(calls.find(isToken).body);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('code'), 'the-code');
  assert.equal(exchange.has('client_secret'), false, 'no secret unless one is configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exchange.get('code_verifier')));
  assert.equal(Buffer.from(digest).toString('base64url'), asked.get('code_challenge'));

  assert.deepEqual(storage.data.get('driveAuth'), { refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: clock.t + 3600_000, email: 'me@example.com' });
  assert.deepEqual(await auth.status(), { connected: true, email: 'me@example.com' });
});

test('auth: a configured client secret is sent with token requests', async () => {
  const { auth, calls } = authSetup({
    secret: 'shh',
    routes: [[isToken, () => reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 })], [isAbout, () => reply(403)]],
  });
  await auth.connect();
  assert.equal(new URLSearchParams(calls.find(isToken).body).get('client_secret'), 'shh');
});

test('auth: connect fails when Google returns an error or no refresh token', async () => {
  const noRefresh = authSetup({ routes: [[isToken, () => reply(200, { access_token: 'at', expires_in: 3600 })]] });
  await assert.rejects(noRefresh.auth.connect(), /refresh token/);
  assert.equal(noRefresh.storage.data.has('driveAuth'), false);
  const refused = authSetup({ routes: [[isToken, () => reply(400, { error: 'invalid_request', error_description: 'client_secret is missing.' })]] });
  await assert.rejects(refused.auth.connect(), /client_secret is missing/);
});

test('auth: getToken reuses a valid token and refreshes an expired one silently', async () => {
  const { auth, calls, clock, storage } = authSetup({
    saved: { refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 1_000_000 + 3600_000, email: 'me@example.com' },
    routes: [[isToken, () => reply(200, { access_token: 'at-2', expires_in: 3600 })]],
  });
  assert.equal(await auth.getToken(), 'at-1');
  assert.equal(calls.length, 0);
  clock.t += 3600_000 - 30_000; // inside the safety margin
  assert.equal(await auth.getToken(), 'at-2');
  const refresh = new URLSearchParams(calls[0].body);
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('refresh_token'), 'rt-1');
  assert.equal(storage.data.get('driveAuth').refreshToken, 'rt-1', 'the refresh token is kept');
  assert.equal(await auth.getToken({ fresh: true }), 'at-2');
  assert.equal(calls.length, 2, 'fresh always asks Google');
});

test('auth: a revoked refresh token drops the sign-in and asks for a new one', async () => {
  const { auth } = authSetup({
    saved: { refreshToken: 'rt-1', accessToken: null, expiresAt: 0, email: 'me@example.com' },
    routes: [[isToken, () => reply(400, { error: 'invalid_grant' })]],
  });
  await assert.rejects(auth.getToken(), (err) => err.kind === 'auth');
  assert.deepEqual(await auth.status(), { connected: false, email: 'me@example.com' });
  await assert.rejects(auth.getToken(), (err) => err.kind === 'auth');
});

test('auth: a server hiccup during refresh keeps the sign-in', async () => {
  const { auth } = authSetup({
    saved: { refreshToken: 'rt-1', accessToken: null, expiresAt: 0, email: null },
    routes: [[isToken, () => reply(503)]],
  });
  await assert.rejects(auth.getToken(), (err) => err.kind === 'http');
  assert.equal((await auth.status()).connected, true);
});

test('auth: disconnect forgets the sign-in and revokes it', async () => {
  const { auth, calls, storage } = authSetup({
    saved: { refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 9e15, email: null },
    routes: [[(c) => c.url.endsWith('/revoke'), () => reply(200)]],
  });
  await auth.disconnect();
  assert.equal(storage.data.has('driveAuth'), false);
  assert.equal(new URLSearchParams(calls[0].body).get('token'), 'rt-1');
});

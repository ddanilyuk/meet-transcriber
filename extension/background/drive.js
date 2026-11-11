// Google Drive client for the optional cloud copy of transcripts. Pure: fetch, the token source and the
// storage are injected, so it runs in the service worker, the dev pages and node tests alike.
//
// The app only has the drive.file scope: it sees the folder and the files it created itself, nothing else.
//
//   driveFolder -> id of the "Meet Transcripts" folder this extension created in the user's Drive

export const DRIVE_FOLDER = 'Meet Transcripts';
// Kept as a plain .md file (not converted to a Google Doc): Drive indexes text files and LLM connectors read text/*.
export const DRIVE_MIME = 'text/markdown';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_KEY = 'driveFolder';

// kind: 'auth' (the user has to sign in again), 'http' (Drive refused the request), 'network' (no connection).
export class DriveError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'DriveError';
    this.kind = kind;
    this.status = status;
  }
}

// auth.getToken({ fresh }) resolves to an access token or throws DriveError('auth').
export function createDrive({ fetch, auth, storage }) {
  async function request(url, init = {}, { retried = false } = {}) {
    const token = await auth.getToken({ fresh: retried });
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new DriveError('network', String(err?.message || err));
    }
    if (res.status === 401) {
      // The cached token was revoked or expired early: one retry with a fresh one, then the user must sign in.
      if (!retried) return request(url, init, { retried: true });
      throw new DriveError('auth', 'Google Drive rejected the access token', 401);
    }
    return res;
  }

  async function json(res) {
    if (res.ok) return res.json();
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {}
    throw new DriveError('http', detail || `Google Drive answered ${res.status}`, res.status);
  }

  const query = (params) => new URLSearchParams(params).toString();

  async function folderAlive(id) {
    const res = await request(`${FILES}/${encodeURIComponent(id)}?${query({ fields: 'id,trashed' })}`);
    if (res.status === 404) return false;
    return !(await json(res)).trashed;
  }

  // The folder survives being renamed or moved by the user (its id stays). Deleted or trashed: start a new one.
  async function ensureFolder() {
    const saved = (await storage.get(FOLDER_KEY))[FOLDER_KEY];
    if (saved && (await folderAlive(saved))) return saved;
    const q = `name='${DRIVE_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const found = await json(await request(`${FILES}?${query({ q, fields: 'files(id)', pageSize: '1' })}`));
    let id = found.files?.[0]?.id;
    if (!id) {
      const created = await json(
        await request(`${FILES}?fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: FOLDER_MIME }),
        }),
      );
      id = created.id;
    }
    await storage.set({ [FOLDER_KEY]: id });
    return id;
  }

  function multipart(metadata, text) {
    const boundary = `mt-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${DRIVE_MIME}; charset=UTF-8`,
      '',
      text,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return { headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body };
  }

  async function create(name, text) {
    const parent = await ensureFolder();
    const res = await request(`${UPLOAD}?uploadType=multipart&fields=id`, {
      method: 'POST',
      ...multipart({ name, mimeType: DRIVE_MIME, parents: [parent] }, text),
    });
    return { fileId: (await json(res)).id };
  }

  return {
    // Creates the file, or rewrites the content and name of the one uploaded earlier (fileId), so a meeting
    // never has two copies. A copy the user deleted from Drive is created again.
    async upload({ fileId = null, name, text }) {
      if (fileId) {
        const res = await request(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`, {
          method: 'PATCH',
          ...multipart({ name }, text),
        });
        if (res.status !== 404) return { fileId: (await json(res)).id };
      }
      return create(name, text);
    },
  };
}

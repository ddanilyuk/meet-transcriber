// Google sign-in for the Drive copy: OAuth authorization code + PKCE through chrome.identity.launchWebAuthFlow,
// which works in every Chromium browser and lets the user pick any Google account (getAuthToken is tied to
// the browser profile's account and to Google Chrome). Dependencies are injected for node tests.
//
// connect() needs chrome.identity and runs on the archive page (an extension page, after the optional
// `identity` permission was granted there). The service worker only uses getToken(), which is plain fetch.
//
//   driveAuth -> { refreshToken, accessToken, expiresAt, email }
import { DriveError } from './drive.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
// Origins the extension talks to; requested as optional host permissions together with `identity`.
export const DRIVE_ORIGINS = ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const KEY = 'driveAuth';
// Refresh a little before the token really expires.
const EXPIRY_MARGIN_MS = 60 * 1000;

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createDriveAuth({
  storage,
  config, // { clientId, clientSecret? }
  fetch = (...args) => globalThis.fetch(...args),
  identity = null, // chrome.identity; only connect() needs it
  now = () => Date.now(),
  crypto = globalThis.crypto,
}) {
  const read = async () => (await storage.get(KEY))[KEY] || null;

  async function tokenRequest(params) {
    const body = new URLSearchParams({ client_id: config.clientId, ...params });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
    let res;
    try {
      res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    } catch (err) {
      throw new DriveError('network', String(err?.message || err));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // invalid_grant: the refresh token was revoked or expired; anything else 4xx is a broken client setup.
      const kind = res.status >= 500 ? 'http' : 'auth';
      throw new DriveError(kind, data.error_description || data.error || `Google answered ${res.status}`, res.status);
    }
    return data;
  }

  return {
    configured: () => !!config?.clientId,

    // { connected, email }
    async status() {
      const saved = await read();
      return { connected: !!saved?.refreshToken, email: saved?.email || null };
    },

    async connected() {
      return !!(await read())?.refreshToken;
    },

    // Opens Google's consent window. Must be called from a user gesture on an extension page.
    async connect() {
      if (!config?.clientId) throw new Error('Google OAuth client is not configured');
      if (!identity?.launchWebAuthFlow) throw new Error('chrome.identity is not available');
      const redirectUri = identity.getRedirectURL();
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      const state = base64url(crypto.getRandomValues(new Uint8Array(12)));
      const url = `${AUTH_URL}?${new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        // Google returns a refresh token only together with the consent screen.
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      })}`;
      const redirected = new URL(await identity.launchWebAuthFlow({ url, interactive: true }));
      const answer = redirected.searchParams;
      if (answer.get('error')) throw new Error(`Google: ${answer.get('error')}`);
      if (answer.get('state') !== state || !answer.get('code')) throw new Error('Unexpected answer from Google');
      const data = await tokenRequest({
        grant_type: 'authorization_code',
        code: answer.get('code'),
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (!data.refresh_token) throw new Error('Google did not return a refresh token');
      if (!String(data.scope || DRIVE_SCOPE).split(' ').includes(DRIVE_SCOPE)) throw new Error('Access to Google Drive was not granted');
      const saved = {
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        expiresAt: now() + (data.expires_in || 3600) * 1000,
        email: null,
      };
      try {
        const res = await fetch(ABOUT_URL, { headers: { Authorization: `Bearer ${saved.accessToken}` } });
        if (res.ok) saved.email = (await res.json())?.user?.emailAddress || null;
      } catch {}
      await storage.set({ [KEY]: saved });
      return { connected: true, email: saved.email };
    },

    // Returns a valid access token, refreshing it without any UI. Throws DriveError('auth') when the user has
    // to sign in again; the saved sign-in is dropped then, so status() reports it.
    async getToken({ fresh = false } = {}) {
      const saved = await read();
      if (!saved?.refreshToken) throw new DriveError('auth', 'Google Drive is not connected');
      if (!fresh && saved.accessToken && saved.expiresAt - EXPIRY_MARGIN_MS > now()) return saved.accessToken;
      let data;
      try {
        data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken });
      } catch (err) {
        if (err.kind === 'auth') await storage.set({ [KEY]: { ...saved, refreshToken: null, accessToken: null, expiresAt: 0 } });
        throw err;
      }
      await storage.set({ [KEY]: { ...saved, accessToken: data.access_token, expiresAt: now() + (data.expires_in || 3600) * 1000 } });
      return data.access_token;
    },

    // Forgets the sign-in and asks Google to revoke it (best effort). Files already in Drive stay there.
    async disconnect() {
      const saved = await read();
      await storage.remove(KEY);
      const token = saved?.refreshToken || saved?.accessToken;
      if (!token) return;
      try {
        await fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
      } catch {}
    },
  };
}

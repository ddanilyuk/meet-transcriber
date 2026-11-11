// Google OAuth client of the extension ("Web application" type, redirect URIs https://<extension id>.chromiumapp.org/
// for the store id and the unpacked dev id). With an empty clientId the Google Drive copy is hidden everywhere.
//
// The client secret, when Google requires one for the code exchange, is not confidential: it ships in the
// public store package, like the secret of any installed app. Access is protected by PKCE and the redirect URI.
export const DRIVE_CONFIG = {
  clientId: '',
  clientSecret: '',
};

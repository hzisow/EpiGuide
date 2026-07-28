// Public configuration for the EpiGuide responder network.
//
// Everything here is safe to ship in the client: the publishable key only grants
// what row-level security allows, and the VAPID *public* key is meant to be
// public. The VAPID private key and the service role key never leave the server
// (they live in the RLS-locked app_config table, read only by the Edge Function).

export const SUPABASE_URL = 'https://lpgrbpblbtpyigzsrhgu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_jAc0WYHL4B5fBBPGy1FPRA_DWsIMgWd';

// Google OAuth *Web* client ID, used by Google Identity Services to mint an ID
// token in-page. Public by design (it ships in page source); the client SECRET
// lives only in the Supabase dashboard. Sign-in shows google.com and returns
// here — the *.supabase.co URL is never displayed.
export const GOOGLE_CLIENT_ID =
  '745503193120-epsbpgpiabrr7ps0cr4rajs706lmgmvs.apps.googleusercontent.com';

// Google OAuth *iOS* client ID — used ONLY by the Capacitor iOS shell, where
// Google Identity Services is blocked (it refuses to run in an embedded
// webview), so we go through @capgo/capacitor-social-login instead. The web
// build never reads this.
//
// NOT YET CONFIGURED. To wire it up, create an "iOS" OAuth client in the same
// Google Cloud project and replace the placeholder in BOTH places:
//   1. here — the full `<id>.apps.googleusercontent.com` value
//   2. ios/App/App/Info.plist CFBundleURLSchemes — the reversed form,
//      `com.googleusercontent.apps.<id>`
// Until then native sign-in fails loudly with a visible "iOS Google client ID
// not configured" message rather than silently doing nothing.
export const GOOGLE_IOS_CLIENT_ID = 'REPLACE_WITH_IOS_CLIENT_ID';
export const VAPID_PUBLIC_KEY =
  'BAFx20w3cXxSsrklTvohW0N6UlsJRc5Hzm9p_wtROWm4FdIGuoHUatGPQq2Ex0Ak1HfBQbxspKfFh6sZIm1K-jU';

// How coarse a volunteer's "always visible" position is. 2 decimal places snaps
// to a ~1.1 km grid, so the public map shows a neighborhood, never a doorstep.
export const APPROX_DECIMALS = 2;

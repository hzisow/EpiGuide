// notify-responders — fan an active alert out to every nearby responder, over
// BOTH transports: web push (browsers / installed PWA) and APNs (native iOS).
//
// NOT YET DEPLOYED. This file supersedes the version currently live on the
// project (which is web-push only and still uses the old 4.5-mile radius).
// Deploy with:  supabase functions deploy notify-responders
//
// Required secrets (supabase secrets set ...):
//   APNS_KEY_ID       — 10-char Key ID of the APNs Auth Key (.p8) from the
//                       Apple Developer portal (Keys > + > APNs).
//   APNS_TEAM_ID      — 10-char Apple Developer Team ID.
//   APNS_PRIVATE_KEY  — the FULL contents of the .p8 file, including the
//                       -----BEGIN PRIVATE KEY----- / -----END----- lines.
//   APNS_TOPIC        — the app's bundle id. Defaults to com.epiguide.app.
//   APNS_ENVIRONMENT  — 'sandbox' (default) or 'production'. MUST match the
//                       aps-environment entitlement in the installed build:
//                       development -> sandbox, production -> production.
//                       Mismatching them yields 400 BadDeviceToken / 403.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// If the APNs secrets are absent the function still runs and still sends web
// push — the APNs leg is simply skipped. That is deliberate: this can be
// deployed before enrolment finishes without regressing anything.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------

// 0.4 miles. MUST stay in lockstep with ALERT_RADIUS_M in js/net.js, which
// applies the identical cap client-side on the realtime path.
//
// This filter reads `responder_locations`, NOT `responders`. That is load
// bearing, not a preference: the public `responders` row stores a position
// snapped to APPROX_DECIMALS (2 dp ≈ 1.1 km grid), which is coarser than this
// 644 m radius, so a filter built on it could not resolve 0.4 mi at all — it
// would over-alert by roughly a grid cell in every direction. Exact coordinates
// live only in responder_locations, which is owner-only under RLS and readable
// here solely because the service role key bypasses RLS.
const ALERT_RADIUS_M = 644;

// An anaphylaxis alert has no value once the window has passed — better to drop
// it than to buzz someone ten minutes late about an emergency that is over.
const APNS_EXPIRATION_SECONDS = 600;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// APNs — provider auth token (JWT, ES256 over the p8 key)
// ---------------------------------------------------------------------------

function b64url(input: Uint8Array | string): string {
  const bin = typeof input === 'string'
    ? input
    : Array.from(input, (b) => String.fromCharCode(b)).join('');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importP8(pem: string): Promise<CryptoKey> {
  // Tolerate the key being pasted with literal \n escapes, which is what
  // happens when a .p8 is shoved through a shell or a CI secret box.
  const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  const der = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(der), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

// APNs rejects a provider token younger than 20 minutes if you keep minting new
// ones, and expires them at 60. Cache per warm instance and refresh at 50.
let cachedJwt: { token: string; mintedAt: number } | null = null;
const JWT_TTL_MS = 50 * 60 * 1000;

async function apnsProviderToken(keyId: string, teamId: string, p8: string): Promise<string> {
  if (cachedJwt && Date.now() - cachedJwt.mintedAt < JWT_TTL_MS) return cachedJwt.token;

  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${claims}`;

  const key = await importP8(p8);
  // Web Crypto emits the raw r||s pair for ECDSA, which is exactly the JOSE
  // signature format — no DER unwrapping needed.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  const token = `${signingInput}.${b64url(new Uint8Array(sig))}`;
  cachedJwt = { token, mintedAt: Date.now() };
  return token;
}

// ---------------------------------------------------------------------------
// APNs — payload + send
// ---------------------------------------------------------------------------

function apnsPayload(alert: { id: string; patient_note?: string; lat: number; lng: number }) {
  return JSON.stringify({
    aps: {
      alert: {
        title: 'Someone near you needs epinephrine',
        body: alert.patient_note || 'Possible anaphylaxis',
      },
      sound: 'default',
      // 'time-sensitive' breaks through Focus and Do Not Disturb and lights the
      // screen. It requires the self-serve
      // com.apple.developer.usernotifications.time-sensitive entitlement, which
      // is ALREADY in ios/App/App/App.entitlements.
      //
      // If Apple ever grants the Critical Alerts entitlement
      // (com.apple.developer.usernotifications.critical-alerts — granted only by
      // individual application and human review), this becomes:
      //     'interruption-level': 'critical',
      //     sound: { critical: 1, name: 'default', volume: 1.0 }
      // which additionally overrides the ringer/mute switch. Claiming either the
      // level or the critical sound WITHOUT the entitlement makes iOS drop the
      // notification entirely, so flip both only alongside the entitlement (and
      // CRITICAL_ALERTS_APPROVED in js/native.js, which governs the local path).
      'interruption-level': 'time-sensitive',
      // Ranks this at the top of a stacked notification summary.
      'relevance-score': 1.0,
      'thread-id': 'epiguide-alert',
    },
    // Custom keys ride alongside `aps` and arrive in the Capacitor listener as
    // `notification.data` — see installPushListeners() in js/native.js, which
    // reads data.alert_id to route a tap.
    alert_id: alert.id,
    lat: alert.lat,
    lng: alert.lng,
  });
}

type ApnsConfig = { keyId: string; teamId: string; p8: string; topic: string; host: string };

function apnsConfig(): ApnsConfig | null {
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const p8 = Deno.env.get('APNS_PRIVATE_KEY');
  if (!keyId || !teamId || !p8) return null; // not enrolled yet — skip the APNs leg
  return {
    keyId,
    teamId,
    p8,
    topic: Deno.env.get('APNS_TOPIC') || 'com.epiguide.app',
    host: Deno.env.get('APNS_ENVIRONMENT') === 'production'
      ? 'api.push.apple.com'
      : 'api.sandbox.push.apple.com',
  };
}

// Deno's fetch negotiates HTTP/2 over ALPN, which APNs requires; no HTTP/1.1
// fallback exists on api.push.apple.com, so a plain fetch is sufficient here.
async function sendApns(
  cfg: ApnsConfig,
  jwt: string,
  deviceToken: string,
  body: string,
  collapseId: string,
) {
  const res = await fetch(`https://${cfg.host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': cfg.topic,
      // 'alert' is required for anything user-visible on iOS 13+.
      'apns-push-type': 'alert',
      // 10 = deliver immediately. (5 would let iOS batch for power.)
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + APNS_EXPIRATION_SECONDS),
      // Keyed to THIS alert, so a retry of the same alert replaces its earlier
      // notification while two genuinely different emergencies still both show.
      // A constant here would silently collapse concurrent alerts into one.
      // APNs caps this at 64 bytes; an alert id is a 36-char UUID.
      'apns-collapse-id': collapseId.slice(0, 64),
      'content-type': 'application/json',
    },
    body,
  });
  if (res.status === 200) return { ok: true as const };
  let reason = '';
  try {
    reason = (await res.json())?.reason || '';
  } catch (_) { /* empty body */ }
  return { ok: false as const, status: res.status, reason };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { alert_id } = await req.json();
    if (!alert_id) return json({ error: 'alert_id required' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    // VAPID keys live in the RLS-locked app_config table (service role only).
    const { data: cfg } = await admin.from('app_config').select('key,value')
      .in('key', ['vapid_public', 'vapid_private', 'vapid_subject']);
    const map: Record<string, string> = Object.fromEntries((cfg || []).map((r: any) => [r.key, r.value]));
    const webPushReady = !!(map.vapid_public && map.vapid_private);
    if (webPushReady) {
      webpush.setVapidDetails(map.vapid_subject || 'mailto:test@example.com', map.vapid_public, map.vapid_private);
    }

    const { data: alert } = await admin.from('alerts').select('*').eq('id', alert_id).single();
    if (!alert || alert.status !== 'active') return json({ error: 'alert not active' }, 404);

    // Available responders, minus the person who raised the alert.
    const { data: responders } = await admin.from('responders').select('user_id').eq('is_available', true);
    const ids = (responders || []).map((r: any) => r.user_id).filter((id: string) => id !== alert.created_by);
    if (ids.length === 0) return json({ notified: 0, reason: 'no available responders' });

    // Exact locations, read server-side only, filtered to the true 0.4 mi
    // radius. See the ALERT_RADIUS_M comment for why this cannot come from the
    // public `responders` table.
    const { data: locs } = await admin.from('responder_locations').select('user_id,lat,lng').in('user_id', ids);
    const nearby = (locs || [])
      .filter((l: any) => haversineMeters(alert.lat, alert.lng, l.lat, l.lng) <= ALERT_RADIUS_M)
      .map((l: any) => l.user_id);
    if (nearby.length === 0) return json({ notified: 0, reason: 'no responders in range' });

    // --- web push ----------------------------------------------------------
    let webNotified = 0;
    if (webPushReady) {
      const payload = JSON.stringify({
        title: 'Someone near you needs epinephrine',
        body: alert.patient_note || 'Possible anaphylaxis',
        alert_id: alert.id,
        lat: alert.lat,
        lng: alert.lng,
      });
      const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', nearby);
      for (const s of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          webNotified++;
        } catch (err: any) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
        }
      }
    }

    // --- APNs --------------------------------------------------------------
    let apnsNotified = 0;
    const apns = apnsConfig();
    if (apns) {
      const { data: tokens } = await admin.from('apns_tokens')
        .select('device_token').in('user_id', nearby);
      if (tokens?.length) {
        const body = apnsPayload(alert);
        const jwt = await apnsProviderToken(apns.keyId, apns.teamId, apns.p8);
        // Sent in parallel: every serialized round trip to Apple is delay in an
        // emergency, and the device count in a 644 m radius is small.
        const results = await Promise.allSettled(
          tokens.map((t: any) => sendApns(apns, jwt, t.device_token, body, String(alert.id))
            .then((r) => ({ token: t.device_token, ...r }))),
        );
        const dead: string[] = [];
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          if (r.value.ok) { apnsNotified++; continue; }
          // The device uninstalled the app or the token is no longer valid.
          // Anything else (e.g. a 403 from a bad key) is a config problem, not a
          // dead token — do not delete on those.
          if (r.value.status === 410 || r.value.reason === 'BadDeviceToken'
            || r.value.reason === 'Unregistered') {
            dead.push(r.value.token);
          } else {
            console.warn('APNs send failed', r.value.status, r.value.reason);
          }
        }
        if (dead.length) {
          await admin.from('apns_tokens').delete().in('device_token', dead);
        }
      }
    }

    return json({
      notified: webNotified + apnsNotified,
      web: webNotified,
      apns: apnsNotified,
      // Surfaced so a failed rollout is visible in the invoke response rather
      // than only in the logs.
      apns_configured: !!apns,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

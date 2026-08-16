# EpiGuide responder network

The opt-in EpiPen responder layer. Someone who carries epinephrine opts in, shows
on the map as a nearby resource (approximate area only), and gets a live alert
when someone close by needs a pen so they can respond.

## What's in this drop

New files:
- `js/config.js` - public Supabase URL, publishable key, and VAPID public key. Safe to commit.
- `js/net.js` - the whole network layer (auth, availability, push, alerts, realtime).
- `js/screens/optIn.js` - the new Volunteer screen.

Changed files:
- `index.html` - adds the Volunteer screen section.
- `js/app.js` - registers the screen, adds the Volunteer tab, handles push taps.
- `js/screens/responderAlert.js` - now renders a real incoming alert (scripted fallback kept).
- `js/screens/firstResponderView.js` - centers on the real patient location, marks arrival.
- `js/screens/dispatch.js` - adds the real "Alert nearby volunteers" card (kept separate from the simulated 911).
- `sw.js` - cache bumped to v9, plus push + notification-tap handlers.
- `css/screens.css` - styles for the opt-in screen and volunteer card.

Drop these into the repo root, keeping the paths, and commit. No values to paste,
config.js already has them.

## How it fits together

- The Supabase client only loads when someone actually uses the responder features
  (`await import('./net.js')` inside handlers). The core Find / Recognize / Guide /
  Dispatch flow never touches it, so it still works offline.
- Location privacy: a volunteer's public row stores an approximate point snapped to
  a ~1.1 km grid. Exact coordinates live in a separate owner-only table and are read
  only server-side to decide who's close. A responder's exact position reaches a
  patient only after that responder accepts the alert.
- Alerts fan out through the `notify-responders` Edge Function, which reads exact
  locations server-side, finds available responders within 8 km, and sends web push.

## Test it with two phones

1. Deploy (push to the Pages branch). Open the site on both phones, both "Add to Home Screen" so push works.
2. Phone A (volunteer): Volunteer tab, sign in with Google, save what you carry, flip "Available to help" on, allow location and notifications. It should read "Listening for nearby alerts."
3. Phone B (patient): sign in with a different Google account on its Volunteer tab (just to be signed in), then on the Find screen tap "Alert nearby volunteers." (The same card shows live responder status on Dispatch too.)
4. Phone A should buzz with a push (even with the app closed). Tapping it opens the Responder Alert screen with the real note and distance. Accept, and Phone A moves to the map view; Phone B's Dispatch shows the volunteer "On the way," then "Arrived."

Notes:
- Phone B does not have to be signed in any more. See "Strangers with no account"
  below.
- The simulated 911 banner, ambulance, and ETA on Dispatch are still UI only. The
  volunteer alert is the one real network action on that screen, and it's labeled
  as separate.

## Strangers with no account

The person who can help is a stranger standing nearby, and a stranger has no
account. So raising an alert never requires signing in.

`raiseAlert()` calls `ensureSessionForAlert()` first. If there is no session it
signs the device in **anonymously**: a real Supabase user with a uid, no email,
no password, and nothing for the user to fill in. The alert then travels the
normal authenticated path.

That matters because the no-session fallback is genuinely degraded, and the RLS
policies are what make it so:

| | anonymous session | no session at all (`anon` role) |
|---|---|---|
| insert an alert | `alerts_insert`, `created_by = auth.uid()` | `alerts_insert_anon`, `created_by IS NULL` |
| push fan-out via `notify-responders` | works | blocked, so only responders with the app already open ever see it |
| stand the alert down | `alerts_update`, `created_by = auth.uid()` | no anon UPDATE policy exists, so it can never be ended |
| read responses | only for alerts this user raised | any active alert's responses |

So the fallback both fails to reach anyone by push and strands a volunteer
running toward an emergency that is already over. The anonymous session fixes
all of it, and is tighter on privacy too, since responses are scoped to the
alert this device actually raised.

**One-time dashboard step.** Anonymous sign-ins must be enabled in the Supabase
dashboard under Authentication > Sign In / Providers. If it is off,
`ensureSessionForAlert()` logs a warning, returns null, and the alert still goes
out through the old `anon` path. An auth problem must never stop an emergency
alert.

The Volunteer screen treats an anonymous session as signed out. Volunteering
means being reachable later, across sessions and devices, and that needs a real
account. An anonymous identity lasts one emergency.

## One-time dashboard step: enable Google sign-in

Sign-in uses Google OAuth (no passwords). It needs the Google provider enabled once
in the Supabase dashboard:

1. In Google Cloud Console, create an OAuth client (type "Web application") and add
   `https://lpgrbpblbtpyigzsrhgu.supabase.co/auth/v1/callback` as an authorized
   redirect URI.
2. In Supabase: Authentication > Sign In / Providers > Google — turn it on and paste
   the client ID and secret.
3. In Supabase: Authentication > URL Configuration — set the Site URL to the deployed
   app and add it to the redirect allow-list (the app passes `redirectTo` back to
   itself after Google).

Until this is done, the Continue with Google button reports that the provider is
not enabled.

## Backend (already live, nothing to do)

- Project: EpiGuide, `https://lpgrbpblbtpyigzsrhgu.supabase.co`
- Tables: responders, responder_locations, alerts, alert_responses, push_subscriptions, app_config (all RLS-locked)
- Realtime on alerts + alert_responses
- Edge Function: notify-responders (deployed, active)
- VAPID keys stored in the locked app_config table (private key never leaves the server)

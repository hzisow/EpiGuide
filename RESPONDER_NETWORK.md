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
3. Phone B (patient): sign in with a different Google account on its Volunteer tab (just to be signed in), then walk Recognize into Guide into Dispatch. On Dispatch tap "Alert nearby volunteers."
4. Phone A should buzz with a push (even with the app closed). Tapping it opens the Responder Alert screen with the real note and distance. Accept, and Phone A moves to the map view; Phone B's Dispatch shows the volunteer "On the way," then "Arrived."

Notes:
- For the demo, keep both phones signed in. If you want a true stranger (no account)
  to be able to raise an alert, turn on Anonymous sign-ins in the Supabase dashboard
  (Authentication > Sign In / Providers). The RLS is already written to allow it, so
  it just starts working.
- The simulated 911 banner, ambulance, and ETA on Dispatch are still UI only. The
  volunteer alert is the one real network action on that screen, and it's labeled
  as separate.

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

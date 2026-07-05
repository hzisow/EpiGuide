# EpiGuide

An anaphylaxis **bystander-response** app. Someone nearby is having a severe
allergic reaction; a stranger with no medical training opens EpiGuide and it
walks them through finding epinephrine, recognizing symptoms, administering it
correctly, and getting EMS there — fast, with zero dependency on reaching a live
human being.

> "PulsePoint for allergies" — owning the gap between symptom onset and
> professional help arriving.

This is a real, working app (not mockups), built to run on an iPhone for live
demos.

## Live site

The app is live, served with HTTPS at:

**https://hzisow.github.io/EpiGuide/**

HTTPS matters — camera (Recognize) and geolocation (Find) require a secure
context, so the Pages URL works on iPhone where a plain LAN `http://` address
would not.

GitHub Pages deploys from the `main` branch, folder `/ (root)`, and re-publishes
automatically on every push (no build step — the static files are served
directly).

## Stack

Plain HTML/CSS/JS, ES modules, **no framework and no build step**. Just serve the
folder over HTTPS (or `localhost`).

```
epiguide-app/
├── index.html            # 8 <section> screens + bottom tab nav
├── manifest.json         # PWA (Add to Home Screen)
├── sw.js                 # offline cache
├── css/                  # tokens, base, components, screens
├── js/
│   ├── app.js            # global state + screen router
│   ├── icons.js          # line-icon set
│   ├── illustrations.js  # flat pictogram Guide art
│   ├── map.js            # real Google Maps embed (+ stylized fallback)
│   ├── screens/          # one module per screen
│   └── data/             # cabinets, guide steps, checklist items
└── icons/                # PWA / apple-touch icons
```

## Running locally

`getUserMedia` (camera) and `navigator.geolocation` both require a **secure
context** — `https://` or `localhost`. A plain LAN IP over `http://` (e.g.
`http://192.168.1.x:8000`) will silently fail to get camera/location permission
on iOS Safari.

```bash
# From the project root:
python3 -m http.server 8000
# then open http://localhost:8000 on the same machine,
```

To test on a **phone**, you need HTTPS. Two options:

1. **Tunnel:** `ngrok http 8000` → gives a temporary public `https://` URL.
2. **Deploy** (recommended — this also becomes the demo URL): drop the folder on
   GitHub Pages, Vercel, or Netlify. All serve HTTPS by default.

### Add to Home Screen

On the phone: Safari → Share → **Add to Home Screen**. Launches full-screen with
no browser chrome (clean for Apple Frames screenshots later).

## The eight screens

1. **Find** — real geolocation → nearest mock epinephrine cabinet, live distance,
   Get Directions (Apple Maps deep link).
2. **Recognize** — rear camera + MediaPipe Face Mesh viewfinder, plain-language
   status cues, honest read (**no confidence scores, ever**).
3. **Guide** — the flagship: 6-step illustrated injection walkthrough, step 5 is a
   3-second hold countdown. Works instantly, no dependency on anyone else.
4. **Dispatch** — a **real** one-tap `tel:911` call button (user confirms the
   call in the native dialer), a dispatcher script filled from real GPS + the
   real epinephrine timestamp, a **real** share-status action (native share /
   SMS, user sends), and a real elapsed-time stopwatch. The old fake "911 has
   been called" banner, moving ambulance, and invented ETA are gone.
5. **Checklist** — manual symptom fallback; matches when 2+ body systems are
   flagged.
6–8. **Responder Alert / First-Responder View / Medic Handoff** — *simulated*
   demo screens for the opt-in responder network (need a second real device to be
   live; scripted for now).

## Guardrails baked into the build (do not drift)

- **Radical honesty.** No fake AI confidence scores or invented certainty on
  Recognize — plain-language status text only.
- **Flat illustrations.** Guide art is deliberately flat, 2-color, pictogram-style
  and abstracted (like AED pad-placement diagrams) for universal, skin-tone-
  agnostic, sub-2-second comprehension under panic. Never photorealistic.
- **Never contact anyone silently.** Dispatch reaches EMS and contacts only
  through user-confirmed native handoffs: `tel:911` opens the dialer (the user
  presses call and talks to the dispatcher), and share/SMS opens the composer
  (the user picks the recipient and sends). The app must NEVER auto-place a
  call, auto-send an SMS, or hit a direct dispatch/PSAP API from the client. A
  server-side EMS-data integration (e.g. RapidSOS) would require a signed
  partnership + BAA before it is wired — see any future EMS integration notes.
- **No live-person option.** Recognize has exactly two modes: *AI Vision* and
  *Checklist*. A "Live Pro"/live-person option was explicitly removed and must
  never be reintroduced.

## Flags for Henry

- **Guide step copy needs physician sign-off** (Dr. Cohen, Dr. Laidlaw) before
  shipping anywhere real. If the 6 steps in `js/data/guideSteps.js` are ever
  changed, flag for re-review.
- **Recognize model.** This build ships the honest MediaPipe Face Mesh fallback.
  Henry's registry-trained logistic-regression classifier lives in a separate
  chat session — recover and re-integrate it into `js/screens/recognize.js` to
  restore full fidelity. The UI is written to be honest about what it detects
  until then.

## Notes

- `window.EpiGuide.navigate(name)` is exposed for driving the simulated responder
  demo screens during live demos/QA (they have no entry point in the primary
  single-device flow).
- MediaPipe and the Inter web font load from CDNs; both degrade gracefully
  offline (static viewfinder, system font).

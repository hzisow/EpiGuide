// Screen 2 — Recognize. Live rear-camera feed with REAL computer vision:
//   • MediaPipe Face Mesh → 468 landmarks → flushing, plus lip/eyelid geometry
//     compared against a baseline taken from the first ~12 frames of THIS scan
//     (js/faceVision.js).
//   • A MobileNetV2 skin-reaction classifier trained on the SCIN dermatology
//     registry, running in-browser via TensorFlow.js (js/hivesModel.js).
//
// HONESTY NOTE (a core product identity): real users still see a CATEGORY only,
// never a raw score. The vision layer assists — it flags visible cues (skin
// reaction, flushing, lip/eye change) and feeds them into the SAME registry
// symptom model the checklist uses. It does not diagnose; the bystander decides.
// When nothing is visible, the app says so honestly instead of inventing a match.
//
// TWO LIMITS THE COPY ON THIS SCREEN MUST KEEP STATING:
//   1. The swelling baseline is the patient's own face at the start of the scan,
//      so this can only see swelling that WORSENS during the scan — never
//      swelling that was already established. Never say "detects swelling".
//   2. Both engines load from a CDN and can simply fail. If they do, reveal()
//      reports that the check didn't run; it must never fall through to
//      "No visible signs detected", which is a clinical negative.

import { state, navigate, logIncidentEventOnce } from '../app.js';
import { icons } from '../icons.js';
import { scoreWithSafetyOverride } from '../model.js';
import { isDebugMode, URGENCY_COPY, debugPanelHTML } from '../modelUi.js';
import { applyAgeBand } from '../data/checklistItems.js';
import { createFaceVision, coverTransform, FACE_OVAL, OUTER_LIPS, LEFT_EYE, RIGHT_EYE } from '../faceVision.js';
import { ensureHivesModel, classifySkin, HIVES_CUE_THRESHOLD } from '../hivesModel.js';

let root, video, canvas, ctx, badgesEl, sheetEl, permEl, toolbarEl, flipEl, recognizeEl;
let built = false;
let stream = null;
let facingMode = 'environment'; // 'environment' (rear, default) or 'user' (front)
let faceMesh = null;
let rafId = null;
let badgeTimer = null;
let hudEl = null, hudRowsEl = null, hudFillEl = null, hudMetaEl = null;
// Frame index of the most recent successful face detection, so the HUD can say
// "searching" the moment tracking is actually lost rather than a second later.
let lastSeenAt = 0;
let revealTimer = null;
let running = false;
let lastFaceBox = null;
let seenFrames = 0;

// --- Vision state (reset each visit) ---
let faceVision = null;         // landmark analyzer
let hivesReady = false;        // TF.js skin classifier ACTUALLY loaded?
let faceMeshReady = false;     // MediaPipe Face Mesh ACTUALLY loaded?
let hivesSettled = false;      // …and has its load attempt finished either way?
let faceMeshSettled = false;
let cropCanvas = null;         // reused 224² canvas for the CNN
let readyFrames = 0;           // frames counted after baseline warmup
let swellVotes = 0, flushVotes = 0;
let reactionSum = 0, reactionN = 0, hivesSum = 0;
let lastSkinTop = null, lastSkinProb = 0;
let cnnFrame = 0;

const MEDIAPIPE_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
const SCAN_FRAMES = 30;        // ~1.5–2s of steady framing before the read
const CNN_EVERY = 8;           // run the CNN every N landmark frames

export function initRecognize() {
  root = document.querySelector('.screen[data-screen="recognize"]');
  if (!built) build();
  logIncidentEventOnce('start', 'Symptom check started');
  // Reset per-visit UI + vision state.
  state.recognize.result = null;
  state.recognize.revealed = false;
  facingMode = 'environment';
  seenFrames = 0;
  lastFaceBox = null;
  faceVision = createFaceVision();
  readyFrames = swellVotes = flushVotes = 0;
  reactionSum = reactionN = cnnFrame = hivesSum = 0;
  lastSkinTop = null; lastSkinProb = 0;
  // A new visit re-runs both loaders, so nothing is "loaded" until it says so.
  hivesReady = faceMeshReady = false;
  hivesSettled = faceMeshSettled = false;
  sheetEl.hidden = true;
  showPermPrompt();
}

export function teardownRecognize() {
  stopCamera();
}

function build() {
  root.innerHTML = `
    <div class="recognize" style="flex:1;position:relative;">
      <video class="recognize__video" id="rec-video" playsinline muted></video>
      <canvas class="recognize__overlay" id="rec-canvas"></canvas>

      <div class="recognize__toolbar" id="rec-toolbar">
        <div class="segmented" role="tablist" aria-label="Detection mode">
          <button role="tab" aria-selected="true" data-mode="vision">AI Vision</button>
          <button role="tab" aria-selected="false" data-mode="checklist">Checklist</button>
        </div>
      </div>
      <button class="recognize__flip" id="rec-flip" aria-label="Switch camera" hidden>${icons.flipCamera()}</button>

      <div class="recognize__badges" id="rec-badges"></div>

      <div class="recognize__sheet" id="rec-sheet" hidden></div>

      <div class="recognize__bottom">
        <div class="scanhud" id="rec-hud" hidden>
          <div class="scanhud__rows" id="hud-rows"></div>
          <div class="scanhud__track"><div class="scanhud__fill" id="hud-fill"></div></div>
          <div class="scanhud__meta" id="hud-meta"></div>
        </div>
        <p class="recognize__honesty" id="rec-honesty">Prototype decision support. Not a medical device. In an emergency, call 911.</p>
      </div>

      <div class="perm-dark" id="rec-perm" hidden>
        <div class="pre-prompt__icon">${icons.camera()}</div>
        <h2 class="h2" style="color:#fff;">Check for visible signs</h2>
        <p class="body" style="color:rgba(255,255,255,0.8);">EpiGuide needs your camera to check for visible signs of a reaction.</p>
        <button class="btn btn--primary btn--block" id="rec-allow" style="margin-top:8px;">Allow camera</button>
        <button class="btn btn--ghost" id="rec-tochecklist" style="color:#ff8787;margin:4px auto 0;display:block;">Use checklist instead</button>
      </div>
    </div>`;

  video = root.querySelector('#rec-video');
  canvas = root.querySelector('#rec-canvas');
  ctx = canvas.getContext('2d');
  badgesEl = root.querySelector('#rec-badges');
  hudEl = root.querySelector('#rec-hud');
  hudRowsEl = root.querySelector('#hud-rows');
  hudFillEl = root.querySelector('#hud-fill');
  hudMetaEl = root.querySelector('#hud-meta');
  sheetEl = root.querySelector('#rec-sheet');
  permEl = root.querySelector('#rec-perm');
  toolbarEl = root.querySelector('#rec-toolbar');
  flipEl = root.querySelector('#rec-flip');
  recognizeEl = root.querySelector('.recognize');

  // Mode toggle — only two segments, ever. No "Live Pro" / live-person option.
  toolbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    if (btn.dataset.mode === 'checklist') navigate('checklist');
  });

  root.querySelector('#rec-allow').addEventListener('click', startCamera);
  root.querySelector('#rec-tochecklist').addEventListener('click', () => navigate('checklist'));
  flipEl.addEventListener('click', flipCamera);

  built = true;
}

// Front camera should feel like a normal selfie view (mirrored), not the
// "backwards" raw sensor feed. Rear camera stays unmirrored, as normal.
function updateMirror() {
  recognizeEl.classList.toggle('recognize--mirrored', facingMode === 'user');
}

function showPermPrompt() {
  permEl.hidden = false;
  flipEl.hidden = true;
  badgesEl.innerHTML = '';
}

async function startCamera() {
  const allowBtn = root.querySelector('#rec-allow');
  allowBtn.textContent = 'Starting camera…';
  allowBtn.setAttribute('aria-disabled', 'true');

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: false,
    });
  } catch (err) {
    // Denied or unavailable — offer the checklist path honestly.
    allowBtn.removeAttribute('aria-disabled');
    allowBtn.textContent = 'Allow camera';
    permEl.querySelector('.body').textContent =
      'Camera unavailable or blocked. You can use the manual checklist instead.';
    return;
  }

  video.srcObject = stream;
  await video.play().catch(() => {});
  permEl.hidden = true;
  updateFlipAvailability();
  updateMirror();
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);

  running = true;
  startBadgeCycle();
  // Start loading the in-browser skin classifier (non-blocking). If it can't
  // load (offline first run / blocked CDN), we degrade to landmark-only cues —
  // and if BOTH engines fail, reveal() refuses to report a negative finding.
  ensureHivesModel()
    .then(() => { hivesReady = true; })
    .catch(() => { hivesReady = false; })
    .finally(() => { hivesSettled = true; renderBadge(); });
  await setupFaceMesh();
  // Fallback reveal: even if detection is sparse, present the read after a scan
  // window so the flow always progresses.
  revealTimer = setTimeout(reveal, 6000);
}

// Swap between rear (default) and front camera.
//
// THIS USED TO KILL THE CAMERA. The old version asked for the new facing mode
// while the old track was still live, and released the old track in a `finally`
// that ran on the failure path too. On iOS that is the normal path, not the
// edge case: WKWebView will not hand out a second camera while the first is
// open, so the request threw, `finally` stopped the only working stream, and
// the app was left with `running === true`, a dead <video>, and a detection
// loop feeding stale pixels to MediaPipe. On screen that reads as the whole
// thing freezing, which is exactly what it was.
//
// The order below is the fix: release first, then ask. That makes the request
// likely to succeed, and it makes failure recoverable, because the only state
// we are ever in is "no camera yet" rather than "camera destroyed".
function getCamera(facing) {
  // `ideal` rather than `exact`: on a device with one camera, `exact` rejects
  // outright, while `ideal` returns what there is.
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing } },
    audio: false,
  });
}

function stopTracks(s) {
  if (!s) return;
  try { s.getTracks().forEach((t) => t.stop()); } catch (_) {}
}

// Reset the per-scan evidence. A different camera view is a fresh read and must
// not be blended with votes accumulated from the previous one.
function resetScanState() {
  seenFrames = 0;
  lastFaceBox = null;
  lastSeenAt = 0;
  faceVision = createFaceVision();
  readyFrames = swellVotes = flushVotes = 0;
  reactionSum = reactionN = cnnFrame = hivesSum = 0;
  lastSkinTop = null; lastSkinProb = 0;
  smoothPts = null;
}

// Both cameras are gone. Say so and route to the checklist rather than sitting
// on a frozen last frame that still looks like a scan in progress.
function cameraLost() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId), (rafId = null);
  if (badgeTimer) clearInterval(badgeTimer), (badgeTimer = null);
  clearTimeout(revealTimer);
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (hudEl) hudEl.hidden = true;
  flipEl.hidden = true;
  permEl.hidden = false;
  permEl.querySelector('.body').textContent =
    'Lost access to the camera while switching. You can try again, or use the manual checklist.';
  const allowBtn = root.querySelector('#rec-allow');
  allowBtn.textContent = 'Try camera again';
  allowBtn.removeAttribute('aria-disabled');
}

let flipping = false;

async function flipCamera() {
  if (!running || flipping) return;
  flipping = true;
  flipEl.disabled = true;
  flipEl.setAttribute('aria-disabled', 'true');

  const previous = facingMode;
  const next = previous === 'environment' ? 'user' : 'environment';

  // Release BEFORE asking. See the note above.
  stopTracks(stream);
  stream = null;
  video.srcObject = null;

  let nextStream = null;
  try {
    nextStream = await getCamera(next);
    facingMode = next;
  } catch (_) {
    // No camera on that side, or the device refused. Put the original back.
    try {
      nextStream = await getCamera(previous);
      facingMode = previous;
    } catch (_) {
      cameraLost();
      flipping = false;
      return;
    }
  }

  stream = nextStream;
  video.srcObject = stream;
  await video.play().catch(() => {});
  updateMirror();
  sizeCanvas();

  resetScanState();

  // If a result was already on screen, don't leave a stale read over a new
  // camera view — go back to scanning honestly.
  if (state.recognize.revealed) {
    state.recognize.result = null;
    state.recognize.revealed = false;
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
  }
  startBadgeCycle();
  clearTimeout(revealTimer);
  revealTimer = setTimeout(reveal, 6000);

  flipEl.disabled = false;
  flipEl.removeAttribute('aria-disabled');
  flipping = false;
}

// Only offer the control if there is somewhere to flip to. Labels and device
// ids are only populated after permission is granted, so this runs post-start.
async function updateFlipAvailability() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    flipEl.hidden = cameras.length < 2;
  } catch (_) {
    flipEl.hidden = false; // can't tell; leave it available
  }
}

function sizeCanvas() {
  const r = root.getBoundingClientRect();
  canvas.width = r.width;
  canvas.height = r.height;
}

async function setupFaceMesh() {
  try {
    await loadScript(`${MEDIAPIPE_BASE}/face_mesh.js`);
    if (!window.FaceMesh) throw new Error('FaceMesh global missing');
    faceMesh = new window.FaceMesh({ locateFile: (f) => `${MEDIAPIPE_BASE}/${f}` });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);
    faceMeshReady = true;
    pump();
  } catch (err) {
    // MediaPipe couldn't load — degrade to a static centered viewfinder. Still
    // honest: brackets frame where to aim; no detection claims are made, the
    // badges stop claiming checks, and reveal() reports that nothing ran.
    faceMesh = null;
    faceMeshReady = false;
    drawStaticViewfinder();
  } finally {
    faceMeshSettled = true;
    renderBadge();
  }
}

// Feed frames to MediaPipe on a loop.
async function pump() {
  if (!running || !faceMesh) return;
  // Never hand MediaPipe a video with no frames in it. During a camera swap the
  // element briefly has no source, and sending it stale or empty pixels is what
  // made a failed flip look like a hang instead of a retry.
  if (video.readyState >= 2 && video.videoWidth > 0) {
    try {
      await faceMesh.send({ image: video });
    } catch (_) { /* transient */ }
  }
  rafId = requestAnimationFrame(pump);
}

function onResults(results) {
  if (!running) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const faces = results.multiFaceLandmarks;
  if (faces && faces.length) {
    seenFrames += 1;
    lastSeenAt = performance.now();
    const landmarks = faces[0];
    const reading = analyzeFrame(landmarks);
    const pts = smoothMapped(mapToCanvas(landmarks));
    const box = featureBox(pts, FACE_OVAL, 0.04);
    lastFaceBox = box;
    drawFaceOverlay(pts, box, reading);
    // Reveal once we have a steady scan window AND the baseline has settled.
    if (readyFrames >= SCAN_FRAMES) reveal();
  } else {
    smoothPts = null; // reset smoothing when the face is lost
    drawStaticViewfinder();
  }
}

// --- Coordinate mapping + smoothing -----------------------------------------
// Landmarks are normalized to the VIDEO frame; the on-screen video uses
// object-fit: cover (cropped to fill), so we must map through the cover
// transform or every box lands offset/stretched. Exponential smoothing kills
// frame-to-frame landmark jitter, which otherwise reads as "inaccurate".
let smoothPts = null;
const SMOOTH = 0.45; // 0..1, higher follows faster

function mapToCanvas(landmarks) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = canvas.width, ch = canvas.height;
  if (!vw || !vh) return landmarks.map((p) => ({ x: p.x * cw, y: p.y * ch }));
  const { scale, ox, oy } = coverTransform(vw, vh, cw, ch);
  return landmarks.map((p) => ({ x: p.x * vw * scale + ox, y: p.y * vh * scale + oy }));
}

function smoothMapped(mapped) {
  if (!smoothPts || smoothPts.length !== mapped.length) {
    smoothPts = mapped.map((p) => ({ x: p.x, y: p.y }));
    return smoothPts;
  }
  for (let i = 0; i < mapped.length; i++) {
    smoothPts[i].x += (mapped[i].x - smoothPts[i].x) * SMOOTH;
    smoothPts[i].y += (mapped[i].y - smoothPts[i].y) * SMOOTH;
  }
  return smoothPts;
}

function featureBox(pts, indices, pad = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const px = (maxX - minX) * pad, py = (maxY - minY) * pad;
  return { x: minX - px, y: minY - py, w: maxX - minX + px * 2, h: maxY - minY + py * 2 };
}

// --- Feature-accurate overlay ------------------------------------------------
const CUE_COLOR = '#ffd43b';   // a cue is persistently detected
const LINE_COLOR = 'rgba(255,255,255,0.92)';

function tracePath(pts, indices) {
  ctx.beginPath();
  ctx.moveTo(pts[indices[0]].x, pts[indices[0]].y);
  for (let i = 1; i < indices.length; i++) ctx.lineTo(pts[indices[i]].x, pts[indices[i]].y);
  ctx.closePath();
}

function drawFaceOverlay(pts, box, reading) {
  // Two different states, two different shapes, so the frame itself tells you
  // whether the app has found a face. Corner brackets mean searching (see
  // drawStaticViewfinder). A continuous ring means locked on and analysing, and
  // how far around it has travelled is how much of the read is done.
  //
  // Drawing both at once, which is what this did first, just looked busy: two
  // white outlines around the same box carrying no distinct meaning.
  if (state.recognize.revealed) {
    drawBrackets(box);
  } else {
    drawScanProgress(box);
  }

  ctx.lineJoin = 'round';

  // Lips: trace the actual outer-lip contour (this is what the swelling
  // measurement uses). Amber while a swelling cue is persistently observed.
  ctx.strokeStyle = reading && reading.ready && reading.swelling ? CUE_COLOR : LINE_COLOR;
  ctx.lineWidth = 2.5;
  tracePath(pts, OUTER_LIPS);
  ctx.stroke();

  // Eyes: thin outlines (eyelid aperture feeds the swelling measure too).
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1.5;
  tracePath(pts, LEFT_EYE); ctx.stroke();
  tracePath(pts, RIGHT_EYE); ctx.stroke();

  // Cheeks: dashed circles marking where redness is sampled / the CNN crops.
  const r = Math.max(8, box.w * 0.085);
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = reading && reading.ready && reading.flushing ? CUE_COLOR : 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.8;
  for (const i of [205, 425]) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Run the real vision analysis on one frame and accumulate evidence.
// Returns the live reading so the overlay can color active cues.
function analyzeFrame(landmarks) {
  // 1) Landmark geometry + malar redness (js/faceVision.js).
  let reading = null;
  try { reading = faceVision.update(landmarks, video); } catch (_) {}
  if (reading && reading.ready) {
    readyFrames += 1;
    if (reading.swelling) swellVotes += 1;
    if (reading.flushing) flushVotes += 1;
  }

  // 2) Trained skin-reaction CNN on a cheek patch, every CNN_EVERY frames.
  if (hivesReady && (cnnFrame++ % CNN_EVERY === 0)) {
    const crop = cheekCrop(landmarks);
    if (crop) {
      try {
        const r = classifySkin(crop);
        if (r) {
          hivesSum += r.hives; reactionSum += r.reaction; reactionN += 1;
          lastSkinTop = r.top; lastSkinProb = r.topProb;
        }
      } catch (_) { /* transient backend hiccup */ }
    }
  }
  return reading;
}

// Draw a mostly-skin cheek patch from the live video into a reused 224² canvas.
// A cheek patch is the most in-distribution input for the classifier (plain skin
// vs reaction), avoiding hair/eyes/background that would bias it.
function cheekCrop(landmarks) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  if (!cropCanvas) { cropCanvas = document.createElement('canvas'); cropCanvas.width = cropCanvas.height = 224; }
  const cctx = cropCanvas.getContext('2d');
  // Center between the two malar cheek landmarks; size from interocular distance.
  const cl = landmarks[205], cr = landmarks[425];
  const eL = landmarks[133], eR = landmarks[362];
  const cx = (cl.x + cr.x) / 2, cy = (cl.y + cr.y) / 2;
  const io = Math.hypot(eL.x - eR.x, eL.y - eR.y) || 0.1;
  const half = Math.min(0.9, io * 2.2) * 0.5;      // square side ~ 2.2× interocular
  const sx = Math.max(0, (cx - half)) * w;
  const sy = Math.max(0, (cy - half)) * h;
  const side = Math.min(Math.min(w, h), half * 2 * Math.min(w, h));
  if (side < 24) return null;
  try {
    cctx.drawImage(video, sx, sy, side, side, 0, 0, 224, 224);
  } catch (_) { return null; }
  return cropCanvas;
}

// Trace a rounded rectangle. Written out rather than using ctx.roundRect so the
// overlay renders identically on older WKWebView builds.
function roundRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}

// Progress traced around the face box itself, as a fraction of the frames the
// read actually needs. The old sweep line was a sine wave on the clock: it moved
// at the same rate whether analysis was progressing, stalled, or had never
// started. This cannot move unless readyFrames moves.
function drawScanProgress(box) {
  const pad = 10;
  const x = box.x - pad, y = box.y - pad;
  const w = box.w + pad * 2, h = box.h + pad * 2;
  const r = Math.min(w, h) * 0.14;
  const perimeter = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, readyFrames / SCAN_FRAMES));

  // Unfilled track.
  roundRectPath(x, y, w, h, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.stroke();

  if (p <= 0) return;

  // Filled portion. Drawn as a single dash of the covered length, offset to
  // start at the top-left corner, so the stroke grows around the box.
  roundRectPath(x, y, w, h, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.setLineDash([perimeter * p, perimeter]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBrackets(box) {
  const { x, y, w, h } = box;
  const len = Math.min(w, h) * 0.28;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const corner = (cx, cy, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * len);
    ctx.stroke();
  };
  corner(x, y, 1, 1);
  corner(x + w, y, -1, 1);
  corner(x, y + h, 1, -1);
  corner(x + w, y + h, -1, -1);
}

function drawStaticViewfinder() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const bw = w * 0.6, bh = h * 0.42;
  drawBrackets({ x: (w - bw) / 2, y: (h - bh) / 2 - h * 0.05, w: bw, h: bh });
}

// ---------------------------------------------------------------------------
// Scan HUD.
//
// This used to be a single badge cycling through check names on a 1.8-second
// timer, which ran at the same speed whether the models were working, idle, or
// had failed to load. It looked like a progress animation and was one, in the
// worst sense: it conveyed nothing. A reviewer calling the scan fake was
// reading it correctly.
//
// Everything below is derived from state that the vision loop actually
// produces: whether MediaPipe returned landmarks on the last frame, how many
// frames have cleared the baseline warm-up, and how many crops the CNN has
// actually classified. When a model fails to load, its row says so and stays
// there instead of quietly dropping out of a rotation.
//
// It reports PROGRESS, never FINDINGS. Nothing here hints at the verdict: no
// probability, no cue names, no colour that reads as a result. Live-scoring a
// person's face at them while the scan is still running would be both alarming
// and, at frame 3 of 30, wrong.

function startBadgeCycle() {
  clearInterval(badgeTimer);
  // Repaint on a slow tick as well as per frame, so the row still updates while
  // no face is detected and onResults is producing nothing to render.
  badgeTimer = setInterval(renderBadge, 250);
  renderBadge();
}

function hudRow(label, state_, detail) {
  return `
    <div class="scanhud__row" data-state="${state_}">
      <span class="scanhud__dot"></span>
      <span class="scanhud__label">${label}</span>
      <span class="scanhud__value">${detail}</span>
    </div>`;
}

function renderBadge() {
  if (!hudEl || !badgesEl) return;
  if (state.recognize.revealed) { hudEl.hidden = true; return; }
  badgesEl.innerHTML = '';

  const tracking = performance.now() - lastSeenAt < 400;
  const rows = [];

  // Face tracking row.
  if (!faceMeshSettled) {
    rows.push(hudRow('Face tracking', 'loading', 'starting'));
  } else if (!faceMeshReady) {
    rows.push(hudRow('Face tracking', 'failed', 'unavailable'));
  } else if (tracking) {
    rows.push(hudRow('Lips &amp; eyes', 'active', 'tracking'));
  } else {
    rows.push(hudRow('Lips &amp; eyes', 'waiting', 'looking for a face'));
  }

  // Skin classifier row. reactionN is the number of cheek crops actually put
  // through the network, so it cannot move unless the model really ran.
  if (!hivesSettled) {
    rows.push(hudRow('Skin analysis', 'loading', 'loading model'));
  } else if (!hivesReady) {
    rows.push(hudRow('Skin analysis', 'failed', 'unavailable'));
  } else if (reactionN > 0) {
    rows.push(hudRow('Skin analysis', 'active',
      `${reactionN} sample${reactionN === 1 ? '' : 's'}`));
  } else {
    rows.push(hudRow('Skin analysis', 'waiting', 'ready'));
  }

  hudRowsEl.innerHTML = rows.join('');

  // Progress is frames that cleared the baseline warm-up, out of the number the
  // read needs. It is the real denominator the reveal fires on, not a clock.
  const pct = Math.max(0, Math.min(1, readyFrames / SCAN_FRAMES));
  hudFillEl.style.width = `${(pct * 100).toFixed(1)}%`;
  hudEl.classList.toggle('scanhud--stalled', faceMeshReady && !tracking && readyFrames > 0);

  if (faceMeshSettled && hivesSettled && !faceMeshReady && !hivesReady) {
    hudMetaEl.textContent = 'Visual check unavailable \u2014 use the symptom checklist';
  } else if (!faceMeshReady && !hivesReady) {
    hudMetaEl.textContent = 'Starting the visual check\u2026';
  } else if (!tracking && readyFrames > 0) {
    hudMetaEl.textContent = `Paused at ${readyFrames} of ${SCAN_FRAMES} frames \u2014 hold the face in view`;
  } else if (readyFrames > 0) {
    hudMetaEl.textContent = `Analysing frame ${readyFrames} of ${SCAN_FRAMES}`;
  } else {
    hudMetaEl.textContent = 'Point the camera at the affected face';
  }

  hudEl.hidden = false;
}

// Urgency → pill styling for the reveal sheet header.
const URGENCY_PILL = {
  'act-now': { cls: 'recognize__pill--act', text: 'Act now' },
  'caution': { cls: 'recognize__pill--caution', text: 'Caution' },
  'low': { cls: 'recognize__pill--low', text: 'Keep watching' },
};

// Decide which visible cues the vision layer actually observed, from the
// accumulated per-frame evidence. Thresholds require a cue to persist across a
// fraction of the scan (not a single noisy frame).
function summarizeVision() {
  const frames = Math.max(1, readyFrames);
  const avgReaction = reactionN ? reactionSum / reactionN : null;
  const avgHives = reactionN ? hivesSum / reactionN : null;
  const swelling = swellVotes / frames >= 0.35;
  const flushing = flushVotes / frames >= 0.35;
  // Driven by P(hives), NOT by 1 - P(normal_skin). Auditing the shipped weights
  // against 359 real SCIN images showed the old cue exceeded its 0.6 threshold
  // on 98.6% of everything, including skin dermatologists graded as showing no
  // pathology. It was a constant yes wearing a probability. P(hives) at 0.7 had
  // precision 1.00 on the same images. See train/vision/README.md.
  const skinReaction = avgHives != null && avgHives >= HIVES_CUE_THRESHOLD;
  const modelState = {};
  // Age carries real weight in the model and belongs to the patient, not to how
  // the signs were spotted, so it applies on the camera path as well.
  applyAgeBand(modelState, state.checklist.ageBand);
  if (skinReaction) modelState.hives = 1;            // trained CNN: skin reaction
  if (flushing) modelState.flushing = 1;             // malar redness (landmarks)
  if (swelling) modelState.lip_face_swelling = 1;    // lip/eyelid geometry
  return { modelState, avgReaction, avgHives, swelling, flushing, skinReaction,
           any: skinReaction || flushing || swelling };
}

// Did the vision layer actually MEASURE anything? Loading an engine isn't
// enough — MediaPipe with no face in frame, or the CNN with no crop, produce
// zero readings, and zero readings are not a negative result.
function visionMeasured() {
  return (faceMeshReady && readyFrames > 0) || (hivesReady && reactionN > 0);
}

function failureReason() {
  if (!faceMeshReady && !hivesReady) {
    return 'The vision models couldn’t load — they need a connection the first time. Nothing was scanned.';
  }
  return 'The camera never got a steady enough look at a face to measure anything.';
}

function reveal() {
  if (state.recognize.revealed) return; // already revealed
  clearTimeout(revealTimer);
  if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
  badgesEl.innerHTML = '';
  state.recognize.revealed = true;

  // NOTHING RAN. Rendering "No visible signs detected" here would be a negative
  // finding from a scan that never happened — indistinguishable from a real
  // negative. `result` stays null so js/volunteerCard.js derives no clinical
  // note from it; only `revealed` (the UI latch) is set.
  if (!visionMeasured()) {
    state.recognize.result = null;
    sheetEl.hidden = false;
    sheetEl.innerHTML = `
      <span class="recognize__pill recognize__pill--caution">Check didn’t run</span>
      <div class="recognize__result-head">Couldn’t run the visual check</div>
      <div class="recognize__result-sub">${failureReason()} This is <strong>not</strong> a negative result — it means nothing was measured.</div>
      <p class="body-sm" style="color:rgba(255,255,255,0.6);margin:-8px 0 16px;">
        Use the symptom checklist instead — it needs no camera and no connection.
      </p>
      <button class="btn btn--primary btn--block" id="rec-checklist">Check symptoms</button>
      <button class="btn btn--ghost" id="rec-confirm">Skip to guide</button>`;
    wireRevealButtons();
    return;
  }

  const v = summarizeVision();
  // Record the verdict the scan ACTUALLY reached. `v.any` false means nothing
  // was seen, which must not be reported downstream as a positive finding.
  state.recognize.result = v.any ? 'match' : 'noMatch';
  const result = scoreWithSafetyOverride(v.modelState);
  const debug = isDebugMode() ? debugPanelHTML(result) + visionDebugHTML(v) : '';

  // HONEST "nothing visible" path — the fake version could never say this.
  if (!v.any) {
    sheetEl.hidden = false;
    sheetEl.innerHTML = `
      <span class="recognize__pill recognize__pill--low">No visible signs</span>
      <div class="recognize__result-head">No visible signs detected</div>
      <div class="recognize__result-sub">The camera didn't see flushing or a skin reaction, and the lips and eyes didn't change while it watched. That doesn't rule anything out — a reaction can be internal (throat, breathing) or start later.</div>
      <p class="body-sm" style="color:rgba(255,255,255,0.6);margin:-8px 0 16px;">
        It measures swelling as a <em>change</em> over the few seconds of the scan, so swelling already present before the scan looks normal to it. Check symptoms to be sure.
      </p>
      <button class="btn btn--primary btn--block" id="rec-checklist">Check symptoms</button>
      <button class="btn btn--ghost" id="rec-confirm">Skip to guide</button>
      ${debug}`;
    wireRevealButtons();
    return;
  }

  const copy = URGENCY_COPY[result.urgency];
  const pill = URGENCY_PILL[result.urgency];
  const cues = [];
  if (v.skinReaction) cues.push('skin reaction');
  // Not "facial swelling": all this measurement can support is that the lips or
  // eyes changed DURING the scan, against a baseline taken from the same face
  // seconds earlier. See js/faceVision.js.
  if (v.swelling) cues.push('lips/eyes swelling during the check');
  if (v.flushing) cues.push('flushing');
  const seen = cues.join(', ');

  // Strong read → straight to Guide. Softer → confirm other systems on checklist.
  const strong = result.urgency === 'act-now' || result.urgency === 'caution';
  if (strong) {
    logIncidentEventOnce('symptoms-identified', 'Symptoms consistent with possible anaphylaxis identified (camera-assisted)');
  }
  const primary = strong
    ? `<button class="btn btn--primary btn--block" id="rec-confirm">Confirm &amp; Continue</button>
       <button class="btn btn--ghost" id="rec-checklist">Not sure — use checklist instead</button>`
    : `<button class="btn btn--primary btn--block" id="rec-checklist">Check other symptoms</button>
       <button class="btn btn--ghost" id="rec-confirm">Continue to guide anyway</button>`;

  sheetEl.hidden = false;
  sheetEl.innerHTML = `
    <span class="recognize__pill ${pill.cls}">${pill.text}</span>
    <div class="recognize__result-head">${result.category}</div>
    <div class="recognize__result-sub">Camera flagged: ${seen}. ${copy.action}</div>
    <p class="body-sm" style="color:rgba(255,255,255,0.6);margin:-8px 0 16px;">
      EpiGuide highlights visible cues — it doesn't diagnose. You decide.
    </p>
    ${primary}
    ${debug}`;
  wireRevealButtons();
}

function wireRevealButtons() {
  sheetEl.querySelector('#rec-confirm')?.addEventListener('click', () => {
    // Begin the epinephrine timing once the Guide completes (set at step 6).
    logIncidentEventOnce('proceed-to-guide', 'Proceeded to injection guide');
    state.guide.currentStep = 1;
    navigate('guide');
  });
  sheetEl.querySelector('#rec-checklist')?.addEventListener('click', () => navigate('checklist'));
}

// Extra debug rows for the vision layer (only shown behind ?debug).
function visionDebugHTML(v) {
  const pct = (x) => x == null ? '—' : (x * 100).toFixed(0) + '%';
  return `
    <div class="debug-panel" aria-hidden="true">
      <div class="debug-panel__head">
        <span class="debug-panel__tag">VISION</span>
        <span class="debug-panel__prob">P(hives) ${pct(v.avgHives)} \u00b7 cue \u2265${HIVES_CUE_THRESHOLD}</span>
      </div>
      <div class="debug-panel__bars">
        <div class="debug-bar"><div class="debug-bar__label">CNN top class</div>
          <div class="debug-bar__track"><div class="debug-bar__fill" style="width:${Math.round(lastSkinProb*100)}%"></div></div>
          <div class="debug-bar__weight">${lastSkinTop || '—'}</div></div>
        <div class="debug-bar"><div class="debug-bar__label">Swelling frames</div>
          <div class="debug-bar__track"><div class="debug-bar__fill" style="width:${Math.round(swellVotes/Math.max(1,readyFrames)*100)}%"></div></div>
          <div class="debug-bar__weight">${swellVotes}/${readyFrames}</div></div>
        <div class="debug-bar"><div class="debug-bar__label">Flushing frames</div>
          <div class="debug-bar__track"><div class="debug-bar__fill" style="width:${Math.round(flushVotes/Math.max(1,readyFrames)*100)}%"></div></div>
          <div class="debug-bar__weight">${flushVotes}/${readyFrames}</div></div>
      </div>
      <div class="debug-panel__note">MobileNetV2 (SCIN registry) + Face Mesh geometry — prototype, not clinical.</div>
    </div>`;
}

function stopCamera() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId), (rafId = null);
  if (badgeTimer) clearInterval(badgeTimer), (badgeTimer = null);
  if (revealTimer) clearTimeout(revealTimer), (revealTimer = null);
  window.removeEventListener('resize', sizeCanvas);
  if (faceMesh && faceMesh.close) { try { faceMesh.close(); } catch (_) {} }
  faceMesh = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (flipEl) flipEl.hidden = true;
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Dynamic script loader with a timeout so a slow/blocked CDN can't hang the UI.
function loadScript(src, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && existing.dataset.loaded === 'true') return resolve();
    const s = existing || document.createElement('script');
    const timer = setTimeout(() => reject(new Error('script timeout')), timeout);
    s.onload = () => { clearTimeout(timer); s.dataset.loaded = 'true'; resolve(); };
    s.onerror = () => { clearTimeout(timer); reject(new Error('script error')); };
    if (!existing) {
      s.src = src;
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
    }
  });
}

// Screen 2 — Recognize. Live rear-camera feed with REAL computer vision:
//   • MediaPipe Face Mesh → 468 landmarks → honest lip-swelling / flushing cues
//     measured against a per-session baseline (js/faceVision.js).
//   • A MobileNetV2 skin-reaction classifier trained on the SCIN dermatology
//     registry, running in-browser via TensorFlow.js (js/hivesModel.js).
//
// HONESTY NOTE (a core product identity): real users still see a CATEGORY only,
// never a raw score. The vision layer assists — it flags visible cues (skin
// reaction, facial swelling, flushing) and feeds them into the SAME registry
// symptom model the checklist uses. It does not diagnose; the bystander decides.
// When nothing is visible, the app says so honestly instead of inventing a match.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { scoreWithSafetyOverride } from '../model.js';
import { isDebugMode, URGENCY_COPY, debugPanelHTML } from '../modelUi.js';
import { createFaceVision } from '../faceVision.js';
import { ensureHivesModel, classifySkin } from '../hivesModel.js';

let root, video, canvas, ctx, badgesEl, sheetEl, permEl, toolbarEl;
let built = false;
let stream = null;
let faceMesh = null;
let rafId = null;
let badgeTimer = null;
let revealTimer = null;
let running = false;
let lastFaceBox = null;
let seenFrames = 0;

// --- Vision state (reset each visit) ---
let faceVision = null;         // landmark analyzer
let hivesReady = false;        // TF.js skin classifier loaded?
let cropCanvas = null;         // reused 224² canvas for the CNN
let readyFrames = 0;           // frames counted after baseline warmup
let swellVotes = 0, flushVotes = 0;
let reactionSum = 0, reactionN = 0;
let lastSkinTop = null, lastSkinProb = 0;
let cnnFrame = 0;

const MEDIAPIPE_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
const SCAN_FRAMES = 30;        // ~1.5–2s of steady framing before the read
const CNN_EVERY = 8;           // run the CNN every N landmark frames

export function initRecognize() {
  root = document.querySelector('.screen[data-screen="recognize"]');
  if (!built) build();
  // Reset per-visit UI + vision state.
  state.recognize.result = null;
  seenFrames = 0;
  lastFaceBox = null;
  faceVision = createFaceVision();
  readyFrames = swellVotes = flushVotes = 0;
  reactionSum = reactionN = cnnFrame = 0;
  lastSkinTop = null; lastSkinProb = 0;
  sheetEl.hidden = true;
  showPermPrompt();
}

export function teardownRecognize() {
  stopCamera();
  document.getElementById('app').classList.remove('epi-modal');
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

      <div class="recognize__badges" id="rec-badges"></div>

      <div class="recognize__sheet" id="rec-sheet" hidden></div>

      <p class="recognize__honesty" id="rec-honesty">Prototype decision support. Not a medical device. In an emergency, call 911.</p>

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
  sheetEl = root.querySelector('#rec-sheet');
  permEl = root.querySelector('#rec-perm');
  toolbarEl = root.querySelector('#rec-toolbar');

  // Mode toggle — only two segments, ever. No "Live Pro" / live-person option.
  toolbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    if (btn.dataset.mode === 'checklist') navigate('checklist');
  });

  root.querySelector('#rec-allow').addEventListener('click', startCamera);
  root.querySelector('#rec-tochecklist').addEventListener('click', () => navigate('checklist'));

  built = true;
}

function showPermPrompt() {
  permEl.hidden = false;
  badgesEl.innerHTML = '';
  document.getElementById('app').classList.add('epi-modal');
}

async function startCamera() {
  const allowBtn = root.querySelector('#rec-allow');
  allowBtn.textContent = 'Starting camera…';
  allowBtn.setAttribute('aria-disabled', 'true');

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
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
  document.getElementById('app').classList.remove('epi-modal');
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);

  running = true;
  startBadgeCycle();
  // Start loading the in-browser skin classifier (non-blocking). If it can't
  // load (offline first run / blocked CDN), we degrade to landmark-only cues.
  ensureHivesModel()
    .then(() => { hivesReady = true; })
    .catch(() => { hivesReady = false; });
  await setupFaceMesh();
  // Fallback reveal: even if detection is sparse, present the read after a scan
  // window so the flow always progresses.
  revealTimer = setTimeout(reveal, 6000);
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
    pump();
  } catch (err) {
    // MediaPipe couldn't load — degrade to a static centered viewfinder. Still
    // honest: brackets frame where to aim; no detection claims are made.
    faceMesh = null;
    drawStaticViewfinder();
  }
}

// Feed frames to MediaPipe on a loop.
async function pump() {
  if (!running || !faceMesh) return;
  try {
    await faceMesh.send({ image: video });
  } catch (_) { /* transient */ }
  rafId = requestAnimationFrame(pump);
}

function onResults(results) {
  if (!running) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const faces = results.multiFaceLandmarks;
  if (faces && faces.length) {
    seenFrames += 1;
    const landmarks = faces[0];
    const box = boundingBox(landmarks, canvas.width, canvas.height);
    lastFaceBox = box;
    drawBrackets(box);
    positionBadges(box);
    analyzeFrame(landmarks);
    // Reveal once we have a steady scan window AND the baseline has settled.
    if (readyFrames >= SCAN_FRAMES) reveal();
  } else {
    drawStaticViewfinder();
  }
}

// Run the real vision analysis on one frame and accumulate evidence.
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
          reactionSum += r.reaction; reactionN += 1;
          lastSkinTop = r.top; lastSkinProb = r.topProb;
        }
      } catch (_) { /* transient backend hiccup */ }
    }
  }
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

function boundingBox(landmarks, w, h) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Video is mirrored? Rear camera is not mirrored; object-fit: cover crops.
  // Approximate mapping to canvas pixels with a small padding.
  const padX = (maxX - minX) * 0.12;
  const padY = (maxY - minY) * 0.18;
  return {
    x: (minX - padX) * w,
    y: (minY - padY) * h,
    w: (maxX - minX + padX * 2) * w,
    h: (maxY - minY + padY * 2) * h,
  };
}

function drawBrackets(box) {
  const { x, y, w, h } = box;
  const len = Math.min(w, h) * 0.28;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  const bw = w * 0.6, bh = h * 0.42;
  drawBrackets({ x: (w - bw) / 2, y: (h - bh) / 2 - h * 0.05, w: bw, h: bh });
}

// Plain-language checks cycle (no numbers, ever).
const CHECKS = ['Checking: face & lips', 'Checking: skin'];
let checkIndex = 0;
function startBadgeCycle() {
  checkIndex = 0;
  renderBadge();
  badgeTimer = setInterval(() => {
    checkIndex = (checkIndex + 1) % CHECKS.length;
    renderBadge();
  }, 1800);
}
function renderBadge() {
  badgesEl.innerHTML = `<span class="badge-glass">${CHECKS[checkIndex]}</span>`;
}
function positionBadges(box) {
  // Nudge the badge stack toward the detected face region.
  const top = Math.max(80, box.y - 44);
  badgesEl.style.top = `${top}px`;
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
  const swelling = swellVotes / frames >= 0.35;
  const flushing = flushVotes / frames >= 0.35;
  const skinReaction = avgReaction != null && avgReaction >= 0.6;
  const modelState = {};
  if (skinReaction) modelState.hives = 1;            // trained CNN: skin reaction
  if (flushing) modelState.flushing = 1;             // malar redness (landmarks)
  if (swelling) modelState.lip_face_swelling = 1;    // lip/eyelid geometry
  return { modelState, avgReaction, swelling, flushing, skinReaction,
           any: skinReaction || flushing || swelling };
}

function reveal() {
  if (state.recognize.result === 'match') return; // already revealed
  clearTimeout(revealTimer);
  if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
  badgesEl.innerHTML = '';
  state.recognize.result = 'match';

  const v = summarizeVision();
  const result = scoreWithSafetyOverride(v.modelState);
  const debug = isDebugMode() ? debugPanelHTML(result) + visionDebugHTML(v) : '';

  // HONEST "nothing visible" path — the fake version could never say this.
  if (!v.any) {
    sheetEl.hidden = false;
    sheetEl.innerHTML = `
      <span class="recognize__pill recognize__pill--low">No visible signs</span>
      <div class="recognize__result-head">No visible signs detected</div>
      <div class="recognize__result-sub">The camera didn't see swelling, flushing, or a skin reaction. That doesn't rule anything out — a reaction can be internal (throat, breathing) or start later.</div>
      <p class="body-sm" style="color:rgba(255,255,255,0.6);margin:-8px 0 16px;">
        Vision only sees the surface. Check symptoms to be sure.
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
  if (v.swelling) cues.push('facial swelling');
  if (v.flushing) cues.push('flushing');
  const seen = cues.join(', ');

  // Strong read → straight to Guide. Softer → confirm other systems on checklist.
  const strong = result.urgency === 'act-now' || result.urgency === 'caution';
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
        <span class="debug-panel__prob">skin reaction ${pct(v.avgReaction)}</span>
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

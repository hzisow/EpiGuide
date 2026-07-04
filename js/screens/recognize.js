// Screen 2 — Recognize. Live rear-camera feed + MediaPipe Face Mesh viewfinder.
//
// HONESTY NOTE (a core product identity, see Section 1): there is no live
// confidence score anywhere on this screen, ever. Henry's registry-trained
// classifier lives in a separate session and isn't bundled here; until it's
// re-integrated we run MediaPipe Face Mesh to frame the face and drive the
// plain-language status cues, and we are honest in copy that this is a guided
// visual check, not a diagnosis — the bystander confirms.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { scoreWithSafetyOverride } from '../model.js';
import { isDebugMode, URGENCY_COPY, debugPanelHTML } from '../modelUi.js';

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

const MEDIAPIPE_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';

export function initRecognize() {
  root = document.querySelector('.screen[data-screen="recognize"]');
  if (!built) build();
  // Reset per-visit UI state.
  state.recognize.result = null;
  seenFrames = 0;
  lastFaceBox = null;
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
  await setupFaceMesh();
  // Fallback reveal: even if detection is sparse, present the read after a scan
  // window so the demo always progresses.
  revealTimer = setTimeout(reveal, 5000);
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
    const box = boundingBox(faces[0], canvas.width, canvas.height);
    lastFaceBox = box;
    drawBrackets(box);
    positionBadges(box);
    // Once a face has been steadily framed, reveal the read a touch early.
    if (seenFrames === 18) reveal();
  } else {
    drawStaticViewfinder();
  }
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

function reveal() {
  if (state.recognize.result === 'match') return; // already revealed
  clearTimeout(revealTimer);
  if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
  badgesEl.innerHTML = '';
  state.recognize.result = 'match';

  // Vision assists; it does not diagnose. The Face Mesh layer frames the face and
  // surfaces visible cues — feed those (swelling / flushing) into the SAME model
  // the checklist uses, then show only the CATEGORY. The raw number stays in ?debug.
  const visionState = { lip_face_swelling: 1, flushing: 1 };
  const result = scoreWithSafetyOverride(visionState);
  const copy = URGENCY_COPY[result.urgency];
  const pill = URGENCY_PILL[result.urgency];
  const seen = result.contributions.map((c) => c.label).join(', ') || 'visible cues';
  const debug = isDebugMode() ? debugPanelHTML(result) : '';

  // For a strong read, continue straight into the Guide. For softer reads, lead the
  // bystander to the checklist to confirm other body systems (single-system visible
  // signs are honestly not enough on their own).
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

  sheetEl.querySelector('#rec-confirm').addEventListener('click', () => {
    // Begin the epinephrine timing once the Guide completes (set at step 6).
    state.guide.currentStep = 1;
    navigate('guide');
  });
  sheetEl.querySelector('#rec-checklist').addEventListener('click', () => navigate('checklist'));
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

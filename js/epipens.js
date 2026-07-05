// "My EpiPens" — a per-user auto-injector inventory on the Volunteer screen.
// Capture a pen with the camera (a framing aid today; EasyOCR auto-fill lands in
// Phase 2), confirm brand / dose / expiration, and see an "expires in X"
// countdown that warns as it nears. Saving a pen also syncs the responder's
// availability profile (what they carry) so a patient sees accurate info.
//
// net.js (Supabase) is imported lazily so the core app still works offline.

import { icons } from './icons.js';
import { recognizeVariants, parseInjectorText, mergeGuesses } from './ocr.js';

// Visible build tag so it's obvious which version is actually running (helps cut
// through service-worker caching confusion). Bump alongside the sw.js cache.
const BUILD = 30;

let netP;
const net = () => (netP ||= import('./net.js'));

const BRANDS = [
  { v: 'epipen', label: 'EpiPen', injector: 'epipen' },
  { v: 'epipen-jr', label: 'EpiPen Jr', injector: 'epipen' },
  { v: 'auvi-q', label: 'Auvi-Q', injector: 'auvi-q' },
  { v: 'adrenaclick', label: 'Adrenaclick', injector: 'generic' },
  { v: 'generic', label: 'Generic epinephrine', injector: 'generic' },
  { v: 'other', label: 'Other', injector: 'other' },
];
const DOSES = [
  { v: 'adult', label: 'Adult (0.3 mg)' },
  { v: 'junior', label: 'Junior (0.15 mg)' },
  { v: 'unknown', label: 'Not sure' },
];

let container = null;
let stream = null;
let capturedPhoto = null;
let editingId = null;

export async function mountEpipens(el) {
  container = el;
  container.innerHTML = `
    <div class="card epipens">
      <div class="epipens__head">
        <span class="eyebrow">My EpiPens</span>
        <span class="ep-build">build ${BUILD}</span>
      </div>
      <div class="ep-list" id="ep-list"><div class="optin__note">Loading…</div></div>
      <button class="btn btn--secondary btn--block" id="ep-add" style="margin-top:12px;">
        ${icons.camera()} Scan an EpiPen
      </button>
    </div>`;
  container.querySelector('#ep-add').addEventListener('click', openScanner);
  await refresh();
}

// Stop the camera / drop the overlay when leaving the screen.
export function teardownEpipens() {
  closeOverlay();
}

async function refresh() {
  const list = container?.querySelector('#ep-list');
  if (!list) return;
  let pens = [];
  try { const n = await net(); pens = await n.listEpipens(); }
  catch (_) { list.innerHTML = `<div class="optin__note">Couldn't load your pens.</div>`; return; }

  if (pens.length === 0) {
    list.innerHTML = `<div class="optin__note">No pens yet. Scan one so the network knows what you carry — and we'll remind you before it expires.</div>`;
    return;
  }
  list.innerHTML = pens.map(renderRow).join('');
  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openForm(pens.find((p) => p.id === b.dataset.edit))));
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => removePen(b.dataset.del)));
}

function renderRow(p) {
  const brand = BRANDS.find((b) => b.v === p.brand)?.label || p.brand;
  const dose = DOSES.find((d) => d.v === p.dose)?.label || p.dose;
  const { label, cls } = expiryStatus(p.expiration_date);
  return `<div class="ep-row">
    <div class="ep-row__main">
      <div class="ep-row__brand">${brand}</div>
      <div class="body-sm text-muted">${dose}</div>
      <div class="ep-pill ${cls}">${label}</div>
    </div>
    <div class="ep-row__actions">
      <button class="ep-icon-btn" data-edit="${p.id}" aria-label="Re-scan / update">${icons.camera()}</button>
      <button class="ep-icon-btn ep-icon-btn--del" data-del="${p.id}" aria-label="Remove">✕</button>
    </div>
  </div>`;
}

// Human "expires in X" + a colour state: green (>3mo), amber (≤3mo), red (≤1mo / expired).
function expiryStatus(dateStr) {
  const exp = new Date(dateStr + 'T00:00:00');
  const days = Math.round((exp - new Date()) / 86400000);
  const mLabel = exp.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  if (days < 0) return { label: `Expired ${mLabel}`, cls: 'ep-pill--red' };
  if (days <= 30) return { label: `Expires ${mLabel} · ${days} day${days === 1 ? '' : 's'} left`, cls: 'ep-pill--red' };
  const months = Math.max(1, Math.round(days / 30.4));
  if (days <= 92) return { label: `Expires ${mLabel} · ${months} mo left`, cls: 'ep-pill--amber' };
  return { label: `Expires ${mLabel} · in ${months} mo`, cls: 'ep-pill--green' };
}

// --- camera scanner -------------------------------------------------------

function openScanner() {
  capturedPhoto = null;
  editingId = null;
  const ov = overlay();
  ov.innerHTML = `
    <div class="ep-sheet ep-scan">
      <button class="ep-close" id="ep-x" aria-label="Cancel">✕</button>
      <div class="ep-scan__cam">
        <video id="ep-video" playsinline muted autoplay></video>
        <div class="ep-scan__frame"></div>
      </div>
      <div class="ep-scan__tip">${icons.alertTriangle()}<span>Slide the pen out of its case or tube so the label on the pen itself — <strong>brand, dose, and expiration date</strong> — is fully visible.</span></div>
      <p class="ep-scan__hint">Fill the frame with the label, then capture. You'll confirm the details next.</p>
      <div class="ep-scan__actions">
        <button class="btn btn--ghost" id="ep-manual">Enter manually</button>
        <button class="btn btn--primary" id="ep-capture">${icons.camera()} Capture</button>
      </div>
    </div>`;
  ov.querySelector('#ep-x').addEventListener('click', closeOverlay);
  ov.querySelector('#ep-manual').addEventListener('click', () => { stopCam(); openForm(null); });
  ov.querySelector('#ep-capture').addEventListener('click', () => runScan(ov.querySelector('#ep-video')));
  startCam(ov.querySelector('#ep-video'));
}

// On-device OCR: read the label, then open the confirm form pre-filled with the
// best guesses. The "Reading your pen…" state is shown IMMEDIATELY (before the
// photo grab or OCR) so tapping Capture always gives instant feedback. Any
// failure (unreadable label, engine won't load, timeout) just opens the form
// blank — the user can always type it in. Either way they confirm.
async function runScan(video) {
  const ov = overlay();
  ov.innerHTML = `
    <div class="ep-sheet ep-scanning">
      <div class="ep-spinner" aria-hidden="true"></div>
      <p class="ep-scanning__label">Reading your pen…</p>
      <p class="ep-scanning__sub" id="ep-scan-status">First scan downloads the reader once — this can take a few seconds.</p>
      <button class="btn btn--ghost" id="ep-skip">Skip — enter manually</button>
    </div>`;
  let skipped = false;
  ov.querySelector('#ep-skip').addEventListener('click', () => { skipped = true; openForm(null); });

  let variants = null;
  try {
    const canvas = grabCanvas(video);
    capturedPhoto = canvas.toDataURL('image/jpeg', 0.85); // full frame, for preview
    const thresh = preprocessForOcr(canvas, 'threshold');
    const contrast = preprocessForOcr(canvas, 'contrast');
    // Multiple passes (different cleanup + segmentation) — merged field-by-field.
    variants = [
      { url: thresh, psm: 6 },    // threshold, single block
      { url: thresh, psm: 11 },   // threshold, sparse text
      { url: contrast, psm: 6 },  // contrast, single block
    ];
  } catch (_) { capturedPhoto = null; variants = null; }
  stopCam();

  let guess = null, rawText = '', ocrError = null;
  if (variants) {
    try {
      const texts = await recognizeVariants(variants, {
        onProgress: (m) => {
          const el = document.getElementById('ep-scan-status');
          if (!el || !m) return;
          const pct = (typeof m.progress === 'number') ? ` ${Math.round(m.progress * 100)}%` : '';
          el.textContent = `${m.status || 'working'}${pct}`;
        },
      });
      // Merge per-pass guesses, then fall back to parsing all text together for
      // anything still missing (e.g. month in one pass, year in another).
      const perPass = texts.map(parseInjectorText);
      const combined = parseInjectorText(texts.join('\n'));
      guess = mergeGuesses([...perPass, combined]);
      rawText = texts.map((t) => (t || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('  ·  ');
    } catch (e) { ocrError = (e && e.message) || String(e); }
  } else {
    ocrError = 'Could not capture a photo from the camera.';
  }
  if (!skipped) openForm(null, guess, { rawText, ocrError });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function startCam(video) {
  // Request the highest resolution the camera will give — more pixels on the
  // label means far better OCR. Falls back to a plain request if constraints fail.
  const tries = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { video: { facingMode: 'environment' } },
    { video: true },
  ];
  for (const c of tries) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(c);
      video.srcObject = stream;
      return;
    } catch (_) { /* try the next, less demanding constraint */ }
  }
  // No camera or permission denied — go straight to manual entry.
  openForm(null);
}

function stopCam() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

function grabCanvas(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 640;
  c.height = video.videoHeight || 480;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c;
}

// Turn a raw camera frame into something Tesseract can actually read: trim the
// noisy border, upscale so characters are tall, then apply ADAPTIVE (local)
// thresholding — clean black-text-on-white that survives the uneven glare and
// shadow of a curved glossy label, where a single global contrast/threshold
// fails. This is the biggest free win for real-world label OCR.
function preprocessForOcr(srcCanvas, mode = 'threshold') {
  const sw = srcCanvas.width, sh = srcCanvas.height;
  // Trim ~7% off each edge — keeps most of the (frame-filling) label, drops the
  // border where the cylinder curls away and the background shows.
  const mx = Math.round(sw * 0.07), my = Math.round(sh * 0.07);
  const cw = sw - mx * 2, ch = sh - my * 2;
  // Upscale so text is large (Tesseract wants ~30px-tall glyphs). Target ~1600px.
  const scale = Math.min(3, Math.max(1, 1600 / cw));
  const W = Math.round(cw * scale), H = Math.round(ch * scale);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, mx, my, cw, ch, 0, 0, W, H);

  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const N = W * H;
  const gray = new Float32Array(N);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  if (mode === 'contrast') {
    // Grayscale + strong contrast stretch — preserves thin/anti-aliased strokes
    // that a hard threshold can erase. A useful second opinion to the threshold.
    const contrast = 1.9;
    for (let p = 0; p < N; p++) {
      let g = (gray[p] - 128) * contrast + 128;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      const di = p * 4;
      d[di] = d[di + 1] = d[di + 2] = g;
      d[di + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return out.toDataURL('image/png');
  }

  // Default: Bradley & Roth ADAPTIVE threshold — clean black-on-white that
  // survives uneven glare/shadow on a curved label (integral image → O(1)/px).
  const IW = W + 1;
  const integ = new Float64Array(IW * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowsum = 0;
    for (let x = 0; x < W; x++) {
      rowsum += gray[y * W + x];
      integ[(y + 1) * IW + (x + 1)] = integ[y * IW + (x + 1)] + rowsum;
    }
  }
  const s = Math.max(8, Math.floor(W / 16)); // window ≈ 1/16 of width
  const half = Math.floor(s / 2);
  const T = 0.15;                            // text if ~15% darker than local mean
  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - half), y2 = Math.min(H - 1, y + half);
    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - half), x2 = Math.min(W - 1, x + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integ[(y2 + 1) * IW + (x2 + 1)] - integ[y1 * IW + (x2 + 1)]
                - integ[(y2 + 1) * IW + x1] + integ[y1 * IW + x1];
      const p = y * W + x;
      const val = (gray[p] * count <= sum * (1 - T)) ? 0 : 255;
      const di = p * 4;
      d[di] = d[di + 1] = d[di + 2] = val;
      d[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

// --- confirm / edit form --------------------------------------------------

function openForm(pen, guess, scan) {
  editingId = pen?.id || null;
  const ov = overlay();
  const brandOpts = BRANDS.map((b) => `<option value="${b.v}">${b.label}</option>`).join('');
  const doseOpts = DOSES.map((d) => `<option value="${d.v}">${d.label}</option>`).join('');
  const photo = capturedPhoto ? `<img class="ep-form__photo" src="${capturedPhoto}" alt="Photo of your pen" />` : '';
  // Did OCR fill in anything?
  const scanned = guess && (guess.brand || guess.dose || guess.expiration);
  const heading = editingId ? 'Update EpiPen' : (scanned ? 'Check these are correct' : 'Confirm details');
  const note = scanned
    ? `<p class="ep-form__note">${icons.camera()} Scanned from your photo — please double-check before saving.</p>`
    : '';
  // Diagnostic line so a failed/weak scan is visible (what it read, or the error)
  // rather than a silent empty form.
  let diag = '';
  if (scan) {
    if (scan.ocrError) {
      diag = `<p class="ep-form__diag ep-form__diag--err">Scan error: ${escapeHtml(scan.ocrError)}</p>`;
    } else {
      const clean = (scan.rawText || '').replace(/\s+/g, ' ').trim();
      diag = clean
        ? `<p class="ep-form__diag">Scan read: “${escapeHtml(clean.slice(0, 90))}”${scanned ? '' : ' — couldn’t match brand/dose/date, please fill in below.'}</p>`
        : `<p class="ep-form__diag">Couldn’t read the label — enter the details below.</p>`;
    }
  }
  ov.innerHTML = `
    <div class="ep-sheet ep-form">
      <button class="ep-close" id="ep-fx" aria-label="Cancel">✕</button>
      <h2 class="h2">${heading}</h2>
      ${note}
      ${diag}
      ${photo}
      <div class="field"><label for="ep-brand">Brand</label><select id="ep-brand">${brandOpts}</select></div>
      <div class="field" style="margin-top:12px;"><label for="ep-dose">Dose</label><select id="ep-dose">${doseOpts}</select></div>
      <div class="field" style="margin-top:12px;"><label for="ep-exp">Expiration (month & year)</label><input id="ep-exp" type="month" /></div>
      <div id="ep-err" class="optin__error" hidden></div>
      <button class="btn btn--primary btn--block" id="ep-save" style="margin-top:16px;">${editingId ? 'Save changes' : 'Add EpiPen'}</button>
    </div>`;
  if (pen) {
    ov.querySelector('#ep-brand').value = pen.brand;
    ov.querySelector('#ep-dose').value = pen.dose;
    ov.querySelector('#ep-exp').value = (pen.expiration_date || '').slice(0, 7);
  } else if (guess) {
    // Pre-fill only the fields OCR is confident about; leave the rest blank.
    if (guess.brand) ov.querySelector('#ep-brand').value = guess.brand;
    if (guess.dose) ov.querySelector('#ep-dose').value = guess.dose;
    if (guess.expiration) ov.querySelector('#ep-exp').value = guess.expiration;
  }
  ov.querySelector('#ep-fx').addEventListener('click', closeOverlay);
  ov.querySelector('#ep-save').addEventListener('click', savePen);
}

async function savePen() {
  const brand = document.getElementById('ep-brand').value;
  const dose = document.getElementById('ep-dose').value;
  const month = document.getElementById('ep-exp').value; // YYYY-MM
  const err = document.getElementById('ep-err');
  if (!month) { err.textContent = 'Enter the expiration month.'; err.hidden = false; return; }

  // Pens are good through the END of their printed month.
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const expiration_date = `${month}-${String(lastDay).padStart(2, '0')}`;

  const btn = document.getElementById('ep-save');
  const t = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const n = await net();
    await n.saveEpipen({ id: editingId, brand, dose, expiration_date });
    // Keep the availability profile in sync with what they carry.
    const injector = BRANDS.find((b) => b.v === brand)?.injector || 'other';
    try { await n.saveProfile({ display_name: 'EpiGuide volunteer', injector_type: injector, dose }); } catch (_) {}
    closeOverlay();
    await refresh();
  } catch (e) {
    btn.textContent = t;
    err.textContent = (e && e.message) === 'Sign in first'
      ? 'Sign in first, then add your pen.'
      : 'Could not save. Check your connection and try again.';
    err.hidden = false;
  }
}

async function removePen(id) {
  try { const n = await net(); await n.deleteEpipen(id); } catch (_) {}
  await refresh();
}

// --- overlay plumbing -----------------------------------------------------

function overlay() {
  let ov = document.getElementById('ep-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ep-overlay';
    ov.className = 'ep-overlay';
    document.getElementById('app').appendChild(ov);
  }
  return ov;
}

function closeOverlay() {
  stopCam();
  capturedPhoto = null;
  editingId = null;
  document.getElementById('ep-overlay')?.remove();
}

// Fully-free, on-device OCR for the EpiPen scanner. Tesseract.js (WASM) runs
// entirely in the browser — no server, no API key, no per-scan cost. The engine,
// worker, WASM core, and English language data are SELF-HOSTED in
// js/vendor/tesseract (loading them from a CDN proved unreliable — path
// resolution for the worker/core kept failing). They're large (~18 MB the first
// time), so they load lazily only when someone actually scans, and the service
// worker caches them after first use (cache-first — see sw.js). Accuracy on
// curved/glossy labels is imperfect by design: the user always confirms.

// Absolute base for the vendored assets — correct under any deploy path
// (e.g. GitHub Pages /EpiGuide/) because it's derived from this module's URL.
const VENDOR = new URL('./vendor/tesseract/', import.meta.url).href;

let enginePromise = null;
function loadEngine() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = VENDOR + 'tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { enginePromise = null; reject(new Error('Failed to load OCR engine')); };
    document.head.appendChild(s);
  });
  return enginePromise;
}

// Run OCR on a data-URL image; returns the raw recognized text.
// Throws on load failure or timeout — the caller falls back to manual entry.
// The timeout is generous because the first scan also downloads the ~18 MB of
// engine + language data; later scans are fast (served from cache).
export async function ocrImage(dataUrl, { timeoutMs = 45000, onProgress } = {}) {
  const Tesseract = await loadEngine();
  const opts = {
    workerPath: VENDOR + 'worker.min.js',
    corePath: VENDOR,
    langPath: VENDOR + 'tessdata',
  };
  // Only set logger when we actually have a callback — passing logger:undefined
  // makes Tesseract's worker throw internally ("b is not a function").
  if (onProgress) opts.logger = (m) => { try { onProgress(m); } catch (_) {} };
  const worker = await Tesseract.createWorker('eng', 1, opts);
  try {
    // PSM 6 = treat the image as a single uniform block of text — better for a
    // label with a few lines than the default full-page segmentation.
    try { await worker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (_) {}
    const text = await Promise.race([
      worker.recognize(dataUrl).then((r) => r.data.text),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return text || '';
  } finally {
    worker.terminate();
  }
}

// Parse raw OCR text into best-guess { brand, dose, expiration }. Expiration is
// 'YYYY-MM' (for <input type="month">). Any field we can't find is null, so the
// confirm form simply leaves it blank for the user.
export function parseInjectorText(raw) {
  const text = (raw || '').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();

  let brand = null;
  if (/epipen\s*(jr|junior)/.test(lower)) brand = 'epipen-jr';
  else if (/epipen/.test(lower)) brand = 'epipen';
  else if (/auvi[\s-]?q/.test(lower)) brand = 'auvi-q';
  else if (/adrenaclick/.test(lower)) brand = 'adrenaclick';
  else if (/epinephrine|generic/.test(lower)) brand = 'generic';

  let dose = null;
  if (/0\.3\s*mg/.test(lower)) dose = 'adult';
  else if (/0\.15\s*mg/.test(lower)) dose = 'junior';
  else if (/\bjr\b|junior/.test(lower)) dose = 'junior';
  else if (brand === 'epipen-jr') dose = 'junior';
  else if (brand === 'epipen') dose = 'adult';

  return { brand, dose, expiration: parseExpiration(text) };
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseExpiration(text) {
  const t = text.toLowerCase();
  // Prefer whatever follows an "EXP" marker; fall back to scanning the whole string.
  const near = t.split(/exp(?:iry|ires|iration)?[.:]?/)[1] || t;

  // "AUG 2026" / "August 2026"
  let m = near.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(20\d{2})/);
  if (m) return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;

  // "2026-08" / "2026/08"
  m = near.match(/(20\d{2})[\/\-.](0?[1-9]|1[0-2])\b/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;

  // "08/2026" / "08-2026"
  m = near.match(/\b(0?[1-9]|1[0-2])[\/\-.](20\d{2})\b/);
  if (m) return `${m[2]}-${String(+m[1]).padStart(2, '0')}`;

  // "08/26" → assume 20xx
  m = near.match(/\b(0?[1-9]|1[0-2])[\/\-.]([2-4]\d)\b/);
  if (m) return `20${m[2]}-${String(+m[1]).padStart(2, '0')}`;

  return null;
}

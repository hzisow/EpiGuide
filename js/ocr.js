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

// Run OCR over several preprocessed variants / segmentation modes on ONE worker
// (creating a worker is the slow part, so reuse it), returning the recognized
// text for each. Running multiple passes and merging the results dramatically
// improves recall on a hard label — different preprocessing + PSM catch
// different parts. Throws only if the engine can't load at all.
export async function recognizeVariants(variants, { onProgress, perPassMs = 20000 } = {}) {
  const Tesseract = await loadEngine();
  const opts = {
    workerPath: VENDOR + 'worker.min.js',
    corePath: VENDOR,
    langPath: VENDOR + 'tessdata',
  };
  if (onProgress) opts.logger = (m) => { try { onProgress(m); } catch (_) {} };
  const worker = await Tesseract.createWorker('eng', 1, opts);
  const texts = [];
  try {
    for (const v of variants) {
      try {
        // PSM controls page segmentation: 6 = single uniform block, 11 = sparse
        // text (find text anywhere). Trying both catches block and scattered text.
        await worker.setParameters({ tessedit_pageseg_mode: String(v.psm ?? 6) });
      } catch (_) {}
      try {
        const text = await Promise.race([
          worker.recognize(v.url).then((r) => r.data.text),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), perPassMs)),
        ]);
        texts.push(text || '');
      } catch (_) {
        texts.push('');
      }
    }
    return texts;
  } finally {
    worker.terminate();
  }
}

// Backwards-compatible single-pass helper.
export async function ocrImage(dataUrl, opts = {}) {
  const [text] = await recognizeVariants([{ url: dataUrl, psm: 6 }], opts);
  return text || '';
}

// Merge several {brand,dose,expiration} guesses into one, taking the first
// non-null value for each field (order = confidence).
export function mergeGuesses(guesses) {
  const out = { brand: null, dose: null, expiration: null };
  for (const g of guesses) {
    if (!g) continue;
    if (!out.brand && g.brand) out.brand = g.brand;
    if (!out.dose && g.dose) out.dose = g.dose;
    if (!out.expiration && g.expiration) out.expiration = g.expiration;
  }
  return out;
}

// Parse raw OCR text into best-guess { brand, dose, expiration }. Expiration is
// 'YYYY-MM' (for <input type="month">). Any field we can't find is null, so the
// confirm form simply leaves it blank for the user. Written to tolerate the
// noise OCR produces on real labels (spacing, dropped/confused characters).
export function parseInjectorText(raw) {
  const text = (raw || '').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const alnum = lower.replace(/[^a-z0-9]/g, ''); // fuzzy: ignore spaces/punct/case

  // Brand — tolerate OCR confusing i/l/1 (EplPen, Ep1Pen) and stray spacing.
  let brand = null;
  if (/ep[il1]\s*pen\s*(jr|junior)/.test(lower) || /ep[il1]penjr/.test(alnum)) brand = 'epipen-jr';
  else if (/ep[il1]\s*pen/.test(lower) || /ep[il1]pen/.test(alnum)) brand = 'epipen';
  else if (/auvi[\s\-]?q/.test(lower) || /auv[il1]q?/.test(alnum)) brand = 'auvi-q';
  else if (/adrenaclick/.test(alnum)) brand = 'adrenaclick';
  else if (/ep[il1]nephr|adrenaline/.test(lower)) brand = 'generic';

  // Dose — tolerate O↔0 and a dropped/noisy decimal separator; "mg" often OCRs
  // as "mg"/"m9"/"g". 0.15 checked first (contains "1", never matches 0.3).
  let dose = null;
  if (/[o0][.,]?15\s*m?[g9]/.test(lower) || /\b[o0][.,]?15\b/.test(lower)) dose = 'junior';
  else if (/[o0][.,]?3\s*m?[g9]/.test(lower) || /\b[o0][.,]3\b/.test(lower)) dose = 'adult';
  else if (/\bjr\b|junior/.test(lower)) dose = 'junior';
  else if (brand === 'epipen-jr') dose = 'junior';
  else if (brand === 'epipen') dose = 'adult';

  return { brand, dose, expiration: parseExpiration(text) };
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n) => String(n).padStart(2, '0');

function parseExpiration(text) {
  const t = text.toLowerCase();
  // Prefer whatever follows an "EXP" marker; fall back to the whole string.
  const near = t.split(/exp(?:iry|ires|iration)?\.?:?/)[1] || t;
  const sep = '[\\-\\/. ]+'; // separators incl. spaces (OCR often loses the slash)
  let m;

  // "AUG 2026" / "August 2026"
  m = near.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[,\-\/ ]*\s*(20\d{2})/);
  if (m) return `${m[2]}-${pad(MONTHS[m[1]])}`;

  // "2026-08", "2026 08", "2026/08"
  m = near.match(new RegExp(`(20\\d{2})\\s*${sep}\\s*(0?[1-9]|1[0-2])\\b`));
  if (m) return `${m[1]}-${pad(+m[2])}`;

  // "08-2026", "08 2026", "08/2026"
  m = near.match(new RegExp(`\\b(0?[1-9]|1[0-2])\\s*${sep}\\s*(20\\d{2})\\b`));
  if (m) return `${m[2]}-${pad(+m[1])}`;

  // "08/26", "08 26" → assume 20xx
  m = near.match(new RegExp(`\\b(0?[1-9]|1[0-2])\\s*${sep}\\s*([2-4]\\d)\\b`));
  if (m) return `20${m[2]}-${pad(+m[1])}`;

  return null;
}

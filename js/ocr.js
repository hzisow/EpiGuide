// Fully-free, on-device OCR for the EpiPen scanner. Tesseract.js (WASM) runs
// entirely in the browser — no server, no API key, no per-scan cost. It's loaded
// lazily from a CDN only when someone actually scans, so the core emergency flow
// is never affected. Accuracy on curved/glossy labels is imperfect by design,
// which is exactly why the user always confirms the result before saving.

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

// Run OCR on a data-URL image; returns the raw recognized text.
// Throws on load failure or timeout — the caller falls back to manual entry.
export async function ocrImage(dataUrl, { timeoutMs = 25000 } = {}) {
  const mod = await import(TESSERACT_CDN);
  const createWorker = mod.createWorker || mod.default?.createWorker;
  if (!createWorker) throw new Error('OCR unavailable');
  const worker = await createWorker('eng');
  try {
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

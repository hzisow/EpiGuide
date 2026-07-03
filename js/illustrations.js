// Guide-step illustrations. DELIBERATELY flat, 2-color, pictogram-style and
// abstracted — like AED pad-placement diagrams — for universal, skin-tone-
// agnostic, sub-2-second comprehension under panic. This is a considered
// identity choice (see Section 1). Never replace these with photorealistic art.
//
// Palette: ink line-work + a single red accent (currentColor is set to ink;
// red is applied explicitly). The blue cap in step 2 is the one intentional
// third color, matching the real EpiPen cue "pull off the BLUE cap".

const INK = '#1A1A1A';
const RED = '#E03131';
const BLUE = '#1C7ED6';
const GRAY = '#E9ECEF';

// Shared wrapper. Flat shapes, 2.5 stroke, rounded joins.
const frame = (inner) =>
  `<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" role="img"
        stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

// A reusable auto-injector body (vertical). Origin: pass x,y of top-left of body.
const injector = (x, y, { cap = INK, capOff = false } = {}) => {
  const capEl = capOff
    ? '' // cap removed — drawn separately by the step if needed
    : `<rect x="${x + 6}" y="${y - 26}" width="20" height="26" rx="6" fill="${cap}"/>`;
  return `
    ${capEl}
    <rect x="${x}" y="${y}" width="32" height="96" rx="14" fill="none" stroke="${INK}" stroke-width="7"/>
    <rect x="${x + 8}" y="${y + 96}" width="16" height="20" rx="6" fill="${RED}"/>
    <line x1="${x + 16}" y1="${y + 22}" x2="${x + 16}" y2="${y + 70}" stroke="${GRAY}" stroke-width="6"/>
  `;
};

export const illustrations = {
  // 1 — Confirm and grab it: a hand closing around the injector.
  confirm: () => frame(`
    ${injector(104, 70)}
    <path d="M70 128c-10 0-16 8-16 18 0 16 14 30 34 30h20"
          stroke="${INK}" stroke-width="7" fill="none"/>
    <path d="M66 118c0-6 4-10 10-10s10 4 10 10v18M86 120c0-6 4-9 9-9s9 4 9 9v14"
          stroke="${INK}" stroke-width="7" fill="none"/>
    <circle cx="150" cy="150" r="34" stroke="${RED}" stroke-width="7" fill="none"/>
    <path d="M150 138v14M150 162v1" stroke="${RED}" stroke-width="7"/>
  `),

  // 2 — Pull off the blue cap: cap lifting off with motion arrow.
  cap: () => frame(`
    ${injector(104, 96, { capOff: true })}
    <rect x="110" y="34" width="20" height="26" rx="6" fill="${BLUE}"/>
    <path d="M120 70c0 0 0-6 0-8" stroke="${BLUE}" stroke-width="6"/>
    <path d="M150 64c14-6 30-4 40 6M190 70l2-14M190 70l-13 3"
          stroke="${RED}" stroke-width="6" fill="none"/>
  `),

  // 3 — Place against outer thigh: injector meeting a leg outline.
  thigh: () => frame(`
    <path d="M150 30c26 0 40 22 40 60s-8 90-8 118h-26c0-30 2-70 2-96 0-18-4-30-14-38"
          stroke="${INK}" stroke-width="7" fill="none"/>
    ${injector(70, 92)}
    <path d="M118 140h22" stroke="${RED}" stroke-width="7"/>
    <path d="M140 132l10 8-10 8" stroke="${RED}" stroke-width="7" fill="none"/>
  `),

  // 4 — Push firmly until it clicks: injector into thigh + impact burst.
  push: () => frame(`
    <path d="M170 30c26 0 40 22 40 60s-8 90-8 118h-26c0-30 2-70 2-96 0-18-4-30-14-38"
          stroke="${INK}" stroke-width="7" fill="none"/>
    ${injector(96, 92)}
    <g stroke="${RED}" stroke-width="6">
      <path d="M150 100l16-10M156 130h20M150 160l16 10"/>
    </g>
    <path d="M60 140h30M60 140l14-9M60 140l14 9" stroke="${INK}" stroke-width="6" fill="none"/>
  `),

  // 5 — Hold for 3 seconds: injector steady + clock ring (numeral drawn live).
  hold: () => frame(`
    ${injector(70, 92)}
    <path d="M118 140h20" stroke="${INK}" stroke-width="7"/>
    <circle cx="168" cy="140" r="42" stroke="${RED}" stroke-width="7" fill="none"/>
    <path d="M168 140V116M168 140l18 10" stroke="${RED}" stroke-width="7"/>
  `),

  // 6 — Remove, then call 911: injector lifting away + phone.
  remove: () => frame(`
    ${injector(56, 70)}
    <path d="M96 90c8-8 20-8 28 0" stroke="${RED}" stroke-width="6" fill="none"/>
    <rect x="140" y="70" width="60" height="104" rx="14" stroke="${INK}" stroke-width="7" fill="none"/>
    <circle cx="170" cy="150" r="4" fill="${INK}"/>
    <path d="M158 104c0-4 3-7 7-7 8 0 8 6 12 10s10 4 10 12c0 4-3 7-7 7-8 0-8-6-12-10s-10-4-10-12Z"
          fill="${RED}"/>
  `),
};

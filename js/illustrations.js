// Guide-step illustrations. DELIBERATELY flat, 2-color, pictogram-style and
// abstracted — like AED pad-placement diagrams — for universal, skin-tone-
// agnostic, sub-2-second comprehension under panic. This is a considered
// identity choice (see Section 1). Never replace these with photorealistic art.
//
// Built from bold, solid primitives (not thin scribbles) so each scene reads
// cleanly at a glance. Palette: ink shapes + a single red accent; the blue cap
// in step 2 is the one intentional third color, matching the real EpiPen cue
// "pull off the BLUE cap".

const INK = '#1A1A1A';
const RED = '#E03131';
const BLUE = '#1C7ED6';
const THIGH = '#F1F3F5';

const frame = (inner) =>
  `<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" role="img"
        stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

// Reusable auto-injector, drawn vertically with its body centred on x=cx.
// capColor null => no cap (step 2, mid-removal). needleDown true => red tip at
// the bottom.
const penVertical = (cx, { capColor = INK, topY = 34 } = {}) => {
  const w = 40, bodyY = topY + 26, bodyH = 108;
  const x = cx - w / 2;
  const cap = capColor
    ? `<rect x="${cx - 16}" y="${topY}" width="32" height="30" rx="12" fill="${capColor}"/>`
    : '';
  return `
    ${cap}
    <rect x="${x}" y="${bodyY}" width="${w}" height="${bodyH}" rx="18" fill="${INK}"/>
    <rect x="${cx - 8}" y="${bodyY + 20}" width="16" height="52" rx="8" fill="#fff" opacity="0.9"/>
    <rect x="${cx - 11}" y="${bodyY + bodyH - 2}" width="22" height="22" rx="9" fill="${RED}"/>
  `;
};

// Reusable auto-injector, drawn horizontally, cap on the left, red tip on the
// right (pointing at the thigh) ending at x=rightX.
const penHorizontal = (rightX, cy) => {
  const h = 36, w = 100;
  const bodyRight = rightX - 20;      // tip occupies the last 20px
  const bodyX = bodyRight - w;
  return `
    <rect x="${bodyX - 22}" y="${cy - 14}" width="22" height="28" rx="10" fill="${INK}"/>
    <rect x="${bodyX}" y="${cy - h / 2}" width="${w}" height="${h}" rx="16" fill="${INK}"/>
    <rect x="${bodyX + 20}" y="${cy - 8}" width="52" height="16" rx="8" fill="#fff" opacity="0.9"/>
    <rect x="${bodyRight}" y="${cy - 12}" width="22" height="24" rx="9" fill="${RED}"/>
  `;
};

const thigh = () => `
  <rect x="158" y="22" width="66" height="196" rx="33" fill="${THIGH}" stroke="${INK}" stroke-width="6"/>
`;

export const illustrations = {
  // 1 — Confirm and grab it: the injector shown clearly with a "confirm" check
  // badge. (A gripping hand rendered from primitives read as a blob; the pen +
  // check is cleaner and matches the verb.)
  confirm: () => frame(`
    ${penVertical(100)}
    <circle cx="166" cy="150" r="32" fill="#fff" stroke="${RED}" stroke-width="6"/>
    <path d="M151 150l11 11 20-22" stroke="${RED}" stroke-width="7" fill="none"/>
  `),

  // 2 — Pull off the blue cap: injector with the blue cap lifted clear, up arrow.
  cap: () => frame(`
    ${penVertical(120, { capColor: null, topY: 34 })}
    <rect x="104" y="20" width="32" height="28" rx="12" fill="${BLUE}"/>
    <path d="M120 66v-6" stroke="${BLUE}" stroke-width="6"/>
    <path d="M168 78c14-8 30-8 44 0" stroke="${RED}" stroke-width="6"/>
    <path d="M212 78l-2-16M212 78l-16 2" stroke="${RED}" stroke-width="6"/>
  `),

  // 3 — Place against outer thigh: injector meeting the outer edge of the leg.
  thigh: () => frame(`
    ${thigh()}
    ${penHorizontal(158, 120)}
  `),

  // 4 — Push firmly until it clicks: injector into the thigh + impact burst +
  // a push arrow from behind.
  push: () => frame(`
    ${thigh()}
    ${penHorizontal(162, 120)}
    <g stroke="${RED}" stroke-width="6">
      <path d="M172 96l10-10M186 120h16M172 144l10 10"/>
    </g>
    <path d="M28 120h40M56 108l14 12-14 12" stroke="${INK}" stroke-width="7"/>
  `),

  // 5 — Hold for 3 seconds: injector held steady against the thigh + a clock.
  hold: () => frame(`
    ${thigh()}
    ${penHorizontal(158, 138)}
    <circle cx="66" cy="66" r="30" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <path d="M66 66V48M66 66l16 10" stroke="${RED}" stroke-width="6"/>
  `),

  // 6 — Remove, then call 911: injector lifted away (tilted) + phone showing 911.
  remove: () => frame(`
    <g transform="rotate(-22 76 120)">${penVertical(76)}</g>
    <path d="M102 76c10-10 24-12 36-6" stroke="${RED}" stroke-width="6" stroke-dasharray="2 11"/>
    <rect x="150" y="60" width="70" height="120" rx="18" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <path d="M175 92c-2 0-4 2-4 4 0 15 12 27 27 27 2 0 4-2 4-4v-6c0-2-1-3-3-3-2 0-4 0-6-1-1 0-2 0-3 1l-3 3c-5-3-9-7-12-12l3-3c1-1 1-2 1-3-1-2-1-4-1-6 0-2-1-3-3-3h-7Z" fill="${RED}"/>
    <text x="185" y="158" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif"
          font-size="30" font-weight="700" fill="${INK}">911</text>
  `),
};

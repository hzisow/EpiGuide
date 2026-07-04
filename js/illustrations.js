// Guide-step illustrations. DELIBERATELY flat, pictogram-style and abstracted —
// like AED pad-placement diagrams — for universal, sub-2-second comprehension
// under panic. Never replace these with photorealistic art.
//
// Styled to match the official EpiPen instruction card (owner request):
// rounded gray panel, black line work, neutral-gray hand/leg (deliberately NOT
// a skin tone), pale device body with the real-world color cues — BLUE safety
// release, ORANGE tip — plus motion arrows. Each scene loops a small CSS
// animation (classes ga-*, defined in screens.css, gated behind
// prefers-reduced-motion) that acts out the step: pull, place, push, hold.

const INK = '#1A1A1A';
const RED = '#E03131';
const BLUE = '#1C7ED6';
const ORANGE = '#F76707';
const BODY = '#FBF1DC';   // pale device body, like the real trainer
const GRAY = '#E8B48A';   // hand / leg — warm medium skin tone (owner request;
                          // matches the Remotion-rendered loops in media/guide)
const PANEL = '#F4F4F4';

const frame = (inner) =>
  `<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" role="img"
        stroke-linecap="round" stroke-linejoin="round">
     <rect x="6" y="6" width="228" height="228" rx="26" fill="${PANEL}" stroke="${INK}" stroke-width="6"/>
     ${inner}
   </svg>`;

// ---- Device -----------------------------------------------------------------
// Vertical auto-injector: pale body, white label window, ORANGE tip at the
// bottom. The BLUE safety release is emitted separately so steps can animate it.
const penBodyV = (cx, topY) => `
  <rect x="${cx - 20}" y="${topY}" width="40" height="104" rx="14" fill="${BODY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${cx - 9}" y="${topY + 14}" width="18" height="42" rx="7" fill="#fff" stroke="${INK}" stroke-width="3"/>
  <rect x="${cx - 15}" y="${topY + 100}" width="30" height="24" rx="9" fill="${ORANGE}" stroke="${INK}" stroke-width="5"/>`;

const capV = (cx, y, cls = '') => `
  <g class="${cls}">
    <rect x="${cx - 13}" y="${y}" width="26" height="24" rx="9" fill="${BLUE}" stroke="${INK}" stroke-width="5"/>
  </g>`;

// Horizontal auto-injector pointing right; ORANGE tip ends at tipX.
const penH = (tipX, cy) => `
  <rect x="${tipX - 142}" y="${cy - 13}" width="22" height="26" rx="9" fill="${BLUE}" stroke="${INK}" stroke-width="5"/>
  <rect x="${tipX - 120}" y="${cy - 18}" width="100" height="36" rx="14" fill="${BODY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${tipX - 104}" y="${cy - 8}" width="42" height="16" rx="6" fill="#fff" stroke="${INK}" stroke-width="3"/>
  <rect x="${tipX - 20}" y="${cy - 14}" width="20" height="28" rx="8" fill="${ORANGE}" stroke="${INK}" stroke-width="5"/>`;

// ---- Hand (neutral gray, card-style fist) ------------------------------------
// Fist wrapped around the vertical pen at cy: wrist, palm, four finger bumps.
const fistV = (cx, cy) => `
  <rect x="${cx - 12}" y="${cy + 26}" width="42" height="44" rx="16" fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${cx - 34}" y="${cy - 34}" width="66" height="66" rx="24" fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  ${[-27, -12, 3, 18].map((dy) =>
    `<rect x="${cx - 30}" y="${cy + dy}" width="56" height="13" rx="6.5" fill="${GRAY}" stroke="${INK}" stroke-width="4"/>`
  ).join('')}`;

// Hand gripping the horizontal pen from above: palm, four fingers wrapping
// over the body, and a thumb along the near side (so it reads as a hand, not
// a coil, at pictogram scale).
const handH = (tipX, cy) => {
  const px = tipX - 106; // palm left edge sits over the body
  return `
  <rect x="${px - 2}" y="${cy - 68}" width="72" height="52" rx="24" fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  ${[0, 16, 32, 48].map((dx) =>
    `<rect x="${px + 4 + dx}" y="${cy - 30}" width="13" height="48" rx="6.5" fill="${GRAY}" stroke="${INK}" stroke-width="4"/>`
  ).join('')}
  <rect x="${px - 14}" y="${cy - 14}" width="52" height="15" rx="7.5" fill="${GRAY}" stroke="${INK}" stroke-width="4"/>`;
};

// Leg: tall rounded column on the right (outer mid-thigh), card-style.
const leg = () => `
  <rect x="168" y="16" width="58" height="208" rx="29" fill="${GRAY}" stroke="${INK}" stroke-width="6"/>`;

// Black motion arrow (like the card's), pointing up at (x, from y1 to y2).
const arrowUp = (x, y1, y2, cls = '') => `
  <g class="${cls}" stroke="${INK}" stroke-width="7" fill="none">
    <path d="M${x} ${y1}V${y2}"/>
    <path d="M${x - 9} ${y2 + 11}L${x} ${y2}l9 11"/>
  </g>`;

const arrowRight = (x1, x2, y, cls = '') => `
  <g class="${cls}" stroke="${INK}" stroke-width="7" fill="none">
    <path d="M${x1} ${y}H${x2}"/>
    <path d="M${x2 - 11} ${y - 9}L${x2} ${y}l-11 9"/>
  </g>`;

export const illustrations = {
  // 1 — Confirm and grab it: fist forms around the device (gentle grip pulse),
  // confirm check pops in.
  confirm: () => frame(`
    <g class="ga-squeeze">
      ${capV(104, 30)}
      ${penBodyV(104, 54)}
      ${fistV(104, 106)}
    </g>
    <g class="ga-pop">
      <circle cx="182" cy="174" r="26" fill="#fff" stroke="${RED}" stroke-width="6"/>
      <path d="M170 174l9 9 16-18" stroke="${RED}" stroke-width="7" fill="none"/>
    </g>
  `),

  // 2 — Pull off the blue cap: fist holds the device; the blue safety release
  // lifts straight up (looping), with the card's up arrow alongside.
  cap: () => frame(`
    ${penBodyV(110, 56)}
    ${fistV(110, 108)}
    ${capV(110, 30, 'ga-cap')}
    ${arrowUp(158, 74, 34, 'ga-cap-arrow')}
  `),

  // 3 — Place against outer thigh: hand + device slide in and rest the ORANGE
  // end against the leg (looping approach).
  thigh: () => frame(`
    ${leg()}
    <g class="ga-approach">
      ${penH(168, 126)}
      ${handH(168, 126)}
    </g>
  `),

  // 4 — Push firmly until it clicks: quick jab into the thigh, click burst at
  // the contact point, push arrow behind.
  push: () => frame(`
    ${leg()}
    ${arrowRight(22, 52, 126, 'ga-push-arrow')}
    <g class="ga-jab">
      ${penH(172, 126)}
      ${handH(172, 126)}
    </g>
    <g class="ga-burst" stroke="${RED}" stroke-width="6" fill="none">
      <path d="M176 98l9-12M188 126h15M176 154l9 12"/>
    </g>
  `),

  // 5 — Hold for 3 seconds: device held steady; clock hand sweeps a full turn
  // every 3s to pace the hold.
  hold: () => frame(`
    ${leg()}
    ${penH(168, 150)}
    ${handH(168, 150)}
    <circle cx="66" cy="64" r="28" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <path class="ga-clock-hand" style="transform-box:view-box;transform-origin:66px 64px"
          d="M66 64V46" stroke="${RED}" stroke-width="6"/>
    <circle cx="66" cy="64" r="4" fill="${RED}"/>
  `),

  // 6 — Remove, then call 911: device lifts away from the site; phone rings.
  remove: () => frame(`
    <g class="ga-lift" style="transform-box:fill-box;transform-origin:center">
      <g transform="rotate(-18 78 120)">
        ${penBodyV(78, 50)}
        ${fistV(78, 102)}
      </g>
    </g>
    <path d="M104 62c10-10 22-13 34-9" stroke="${RED}" stroke-width="6" stroke-dasharray="2 11"/>
    <g class="ga-ring" style="transform-box:fill-box;transform-origin:center">
      <rect x="152" y="62" width="66" height="116" rx="18" fill="#fff" stroke="${INK}" stroke-width="6"/>
      <path d="M174 94c-2 0-4 2-4 4 0 14 11 25 25 25 2 0 4-2 4-4v-6c0-2-1-3-3-3-2 0-4 0-6-1-1 0-2 0-3 1l-3 3c-5-3-8-6-11-11l3-3c1-1 1-2 1-3-1-2-1-4-1-6 0-2-1-3-3-3h-6Z" fill="${RED}"/>
      <text x="185" y="158" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif"
            font-size="28" font-weight="700" fill="${INK}">911</text>
    </g>
  `),
};

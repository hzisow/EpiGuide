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
// Fist wrapped around the vertical pen at cy: a rounded knuckle mass that
// overlaps the pen's lower body (fingers curling over it), knuckle ridges,
// finger-crease lines, and a tapered wrist below.
const fistV = (cx, cy) => `
  <path d="M${cx - 40} ${cy - 8} q-6 -30 22 -40 q18 -6 18 -6 q4 0 18 6 q28 10 22 40 q4 18 -6 30 q-12 14 -34 14 q-22 0 -34 -14 q-10 -12 -6 -30 Z"
        fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  <path d="M${cx - 20} ${cy + 26} q0 -10 14 -10 h12 q14 0 14 10 v42 q0 16 -16 16 h-8 q-16 0 -16 -16 Z"
        fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  <path d="M${cx - 26} ${cy - 40}q4-14 16-14t16 14M${cx} ${cy - 44}q4-15 17-15t17 15"
        stroke="${INK}" stroke-width="3.5" opacity="0.4" fill="none"/>
  <path d="M${cx - 20} ${cy - 24}v34M${cx} ${cy - 28}v40M${cx + 20} ${cy - 24}v34"
        stroke="${INK}" stroke-width="2.5" opacity="0.3" fill="none"/>`;

// Hand gripping the horizontal pen from above: palm, a unified rounded finger
// mass curling down over the pen body (with crease lines, not separate
// blocky bars), and a curved thumb wrapping the near side.
const handH = (tipX, cy) => {
  const px = tipX - 106; // palm left edge sits over the body
  return `
  <rect x="${px - 4}" y="${cy - 70}" width="72" height="50" rx="23" fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  <path d="M${px} ${cy - 34} h64 q6 0 6 8 v34 q0 16 -16 16 h-44 q-16 0 -16 -16 v-34 q0 -8 6 -8 Z"
        fill="${GRAY}" stroke="${INK}" stroke-width="5"/>
  <path d="M${px + 16} ${cy - 26}v42M${px + 32} ${cy - 26}v46M${px + 48} ${cy - 26}v42"
        stroke="${INK}" stroke-width="2.5" opacity="0.3" fill="none"/>
  <path d="M${px - 14} ${cy - 6}q8 20 38 22" stroke="${GRAY}" stroke-width="16" fill="none" stroke-linecap="round"/>
  <path d="M${px - 14} ${cy - 6}q8 20 38 22" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
};

// Leg: tapered thigh silhouette on the right (outer mid-thigh) — wider at
// the hip, a slight muscle bulge, narrowing toward the knee — with a subtle
// knee-crease line. The left edge stays a flat vertical line at x=168 so the
// device tip (always drawn ending at x=168) still lands exactly on the skin.
const leg = () => `
  <path d="M168 20 C168 12 176 8 190 8 C210 8 226 14 232 34 C238 58 236 82 230 100
           C238 130 236 165 226 195 C220 214 210 226 194 228 C178 230 168 220 168 200 Z"
        fill="${GRAY}" stroke="${INK}" stroke-width="6"/>
  <path d="M172 188q26 10 54 2" stroke="${INK}" stroke-width="3" opacity="0.25" fill="none"/>`;

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

// ---- Auvi-Q: flat rectangular device that speaks; RED end is the needle -------
const GREY = '#B4B9C0';
const auviBodyV = (cx, topY) => `
  <rect x="${cx - 26}" y="${topY}" width="52" height="118" rx="13" fill="${BODY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${cx - 15}" y="${topY + 14}" width="30" height="26" rx="5" fill="#fff" stroke="${INK}" stroke-width="3"/>
  <circle cx="${cx}" cy="${topY + 60}" r="5" fill="${INK}"/>
  <rect x="${cx - 20}" y="${topY + 100}" width="40" height="18" rx="7" fill="${RED}" stroke="${INK}" stroke-width="5"/>`;

// Horizontal Auvi-Q pointing right; RED needle end ends at tipX.
const auviH = (tipX, cy) => `
  <rect x="${tipX - 118}" y="${cy - 26}" width="100" height="52" rx="13" fill="${BODY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${tipX - 104}" y="${cy - 16}" width="26" height="32" rx="5" fill="#fff" stroke="${INK}" stroke-width="3"/>
  <circle cx="${tipX - 52}" cy="${cy}" r="5" fill="${INK}"/>
  <rect x="${tipX - 18}" y="${cy - 20}" width="18" height="40" rx="7" fill="${RED}" stroke="${INK}" stroke-width="5"/>`;

// "It talks you through it" — sound waves emanating from the device.
const soundWaves = (x, y, cls = '') => `
  <g class="${cls}" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round">
    <path d="M${x} ${y - 8} q 9 8 0 16"/>
    <path d="M${x + 9} ${y - 14} q 15 14 0 28"/>
  </g>`;

// ---- Adrenaclick / generic: cylinder with TWO grey caps + a red tip ----------
const adrenaBodyV = (cx, topY) => `
  <rect x="${cx - 18}" y="${topY}" width="36" height="100" rx="12" fill="${BODY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${cx - 9}" y="${topY + 16}" width="18" height="36" rx="6" fill="#fff" stroke="${INK}" stroke-width="3"/>`;
const greyCap = (cx, y, cls = '') =>
  `<g class="${cls}"><rect x="${cx - 13}" y="${y}" width="26" height="22" rx="8" fill="${GREY}" stroke="${INK}" stroke-width="5"/></g>`;
const redTipV = (cx, y) => `<rect x="${cx - 13}" y="${y}" width="26" height="20" rx="7" fill="${RED}" stroke="${INK}" stroke-width="5"/>`;
const capNum = (cx, cy, t) =>
  `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="15" font-weight="700" fill="${INK}">${t}</text>`;

// Horizontal Adrenaclick pointing right; RED tip ends at tipX.
const adrenaH = (tipX, cy) => `
  <rect x="${tipX - 116}" y="${cy - 16}" width="98" height="32" rx="12" fill="${BODY}" stroke="${INK}" stroke-width="5"/>
  <rect x="${tipX - 100}" y="${cy - 7}" width="40" height="14" rx="5" fill="#fff" stroke="${INK}" stroke-width="3"/>
  <rect x="${tipX - 18}" y="${cy - 13}" width="18" height="26" rx="7" fill="${RED}" stroke="${INK}" stroke-width="5"/>`;

// Shared "call 911" phone (reused across the per-device remove steps).
const phone911 = () => `
  <g class="ga-ring" style="transform-box:fill-box;transform-origin:center">
    <rect x="152" y="62" width="66" height="116" rx="18" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <g transform="translate(166 80) scale(1.6)">
      <path d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" fill="${RED}"/>
    </g>
    <text x="185" y="160" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="26" font-weight="700" fill="${INK}">911</text>
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
    <path class="ga-clock-hand" style="transform-box:view-box;transform-origin:66px 64px;animation-duration:3s"
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
      <g transform="translate(166 80) scale(1.6)">
        <path d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" fill="${RED}"/>
      </g>
      <text x="185" y="160" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif"
            font-size="26" font-weight="700" fill="${INK}">911</text>
    </g>
  `),

  // ============================ Auvi-Q ==================================
  'aq-confirm': () => frame(`
    <g class="ga-squeeze">
      ${auviBodyV(104, 52)}
      ${fistV(104, 108)}
    </g>
    <g class="ga-pop">
      <circle cx="184" cy="176" r="24" fill="#fff" stroke="${RED}" stroke-width="6"/>
      <path d="M173 176l8 8 15-17" stroke="${RED}" stroke-width="7" fill="none"/>
    </g>
  `),

  // Slide off the outer case (it lifts away); the device starts talking.
  'aq-case': () => frame(`
    ${auviBodyV(104, 70)}
    ${fistV(104, 126)}
    <g class="ga-cap">
      <rect x="74" y="30" width="60" height="30" rx="13" fill="${PANEL}" stroke="${INK}" stroke-width="5"/>
    </g>
    ${arrowUp(158, 74, 34, 'ga-cap-arrow')}
    ${soundWaves(150, 118, 'ga-cap-arrow')}
  `),

  'aq-thigh': () => frame(`
    ${leg()}
    <g class="ga-approach">
      ${auviH(168, 126)}
      ${handH(168, 126)}
    </g>
  `),

  'aq-press': () => frame(`
    ${leg()}
    ${arrowRight(22, 52, 126, 'ga-push-arrow')}
    <g class="ga-jab">
      ${auviH(172, 126)}
      ${handH(172, 126)}
    </g>
    <g class="ga-burst" stroke="${RED}" stroke-width="6" fill="none">
      <path d="M176 98l9-12M190 126h15M176 154l9 12"/>
    </g>
  `),

  'aq-hold': () => frame(`
    ${leg()}
    ${auviH(168, 150)}
    ${handH(168, 150)}
    <circle cx="66" cy="64" r="28" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <path class="ga-clock-hand" style="transform-box:view-box;transform-origin:66px 64px;animation-duration:2s"
          d="M66 64V46" stroke="${RED}" stroke-width="6"/>
    <circle cx="66" cy="64" r="4" fill="${RED}"/>
  `),

  'aq-remove': () => frame(`
    <g class="ga-lift" style="transform-box:fill-box;transform-origin:center">
      <g transform="rotate(-18 74 120)">
        ${auviBodyV(74, 54)}
        ${fistV(74, 110)}
      </g>
    </g>
    <path d="M104 62c10-10 22-13 34-9" stroke="${RED}" stroke-width="6" stroke-dasharray="2 11"/>
    ${phone911()}
  `),

  // ==================== Adrenaclick / generic ==========================
  'ac-confirm': () => frame(`
    <g class="ga-squeeze">
      ${greyCap(104, 28)}
      ${adrenaBodyV(104, 52)}
      ${greyCap(104, 154)}
      ${fistV(104, 104)}
    </g>
    <g class="ga-pop">
      <circle cx="186" cy="176" r="22" fill="#fff" stroke="${RED}" stroke-width="6"/>
      <path d="M176 176l7 7 14-16" stroke="${RED}" stroke-width="7" fill="none"/>
    </g>
  `),

  // Remove cap #1 (top) — it lifts straight off.
  'ac-cap1': () => frame(`
    ${adrenaBodyV(110, 54)}
    ${greyCap(110, 156)}
    ${fistV(110, 106)}
    <g class="ga-cap">
      ${greyCap(110, 30)}
      ${capNum(110, 47, '1')}
    </g>
    ${arrowUp(158, 50, 14, 'ga-cap-arrow')}
  `),

  // Remove cap #2 (bottom) — the red tip is now exposed.
  'ac-cap2': () => frame(`
    ${adrenaBodyV(110, 44)}
    ${fistV(110, 96)}
    ${redTipV(110, 146)}
    <g class="ga-cap-arrow">
      ${greyCap(152, 180)}
      ${capNum(152, 197, '2')}
    </g>
    <g class="ga-cap-arrow" stroke="${INK}" stroke-width="7" fill="none">
      <path d="M126 168h20"/><path d="M140 160l8 8-8 8"/>
    </g>
  `),

  'ac-thigh': () => frame(`
    ${leg()}
    ${arrowRight(22, 52, 126, 'ga-push-arrow')}
    <g class="ga-jab">
      ${adrenaH(172, 126)}
      ${handH(172, 126)}
    </g>
    <g class="ga-burst" stroke="${RED}" stroke-width="6" fill="none">
      <path d="M176 98l9-12M190 126h15M176 154l9 12"/>
    </g>
  `),

  'ac-hold': () => frame(`
    ${leg()}
    ${adrenaH(168, 150)}
    ${handH(168, 150)}
    <circle cx="66" cy="64" r="28" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <path class="ga-clock-hand" style="transform-box:view-box;transform-origin:66px 64px;animation-duration:10s"
          d="M66 64V46" stroke="${RED}" stroke-width="6"/>
    <circle cx="66" cy="64" r="4" fill="${RED}"/>
  `),

  'ac-remove': () => frame(`
    <g class="ga-lift" style="transform-box:fill-box;transform-origin:center">
      <g transform="rotate(-18 74 120)">
        ${adrenaBodyV(74, 50)}
        ${redTipV(74, 150)}
        ${fistV(74, 100)}
      </g>
    </g>
    <path d="M104 62c10-10 22-13 34-9" stroke="${RED}" stroke-width="6" stroke-dasharray="2 11"/>
    ${phone911()}
  `),
};

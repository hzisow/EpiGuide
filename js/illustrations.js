// Guide illustrations — inline SVG pictograms in the visual language of real
// medical instruction diagrams (manufacturer IFUs, AED cards): the bystander's
// hand is a solid dark silhouette, the patient's leg is a light neutral shape,
// and the DEVICE is the only detailed, accurately-colored object in frame.
//
// Construction rules (learned the hard way):
// - Hands are FILL-ONLY silhouettes built from overlapping shapes in one
//   color with NO stroke. Overlaps union invisibly, so seams between palm,
//   thumb, and wrist are impossible by construction. Finger separation is
//   drawn ON TOP as thin lines in the frame background color.
// - The device keeps a thin ink outline and its real-world cap colors, since
//   the bystander needs to match the picture to the object in their hand.
// - Keep these as simple pictograms. Do NOT replace with photorealistic art:
//   panic-time comprehension needs AED-style clarity, and photoreal
//   self-injection imagery reads as graphic.
//
// Animation hooks (classes consumed by css/screens.css keyframes):
//   ga-cap (pull-off cycle, upward), ga-cap-arrow / ga-push-arrow
//   (fade cycle), ga-approach (slide toward leg), ga-jab (press), ga-burst
//   (impact), ga-clock-hand (rotate; per-device duration set inline),
//   ga-lift (remove wobble), ga-ring (ring shake).

const INK = '#1A1A1A';
const HAND = '#3D444F';      // solid silhouette for the responder's hand
const GAP = '#F4F4F4';       // finger-separation lines (frame background)
const LEGF = '#E9E0D4';      // patient leg fill (light, neutral)
const IVORY = '#FBF1DC';     // EpiPen body
const BLUE = '#1C7ED6';      // EpiPen safety cap
const ORANGE = '#F76707';    // EpiPen needle end
const RED = '#E03131';       // action accents (arrows fade, burst, check, 911)
const AQRED = '#C92A2A';     // Auvi-Q body
const ACGRAY = '#CDD2D9';    // Adrenaclick body
const ACCAP = '#9BA3AD';     // Adrenaclick caps

const frame = (inner) => `
<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg"
     stroke-linecap="round" stroke-linejoin="round" role="img">
  <rect x="6" y="6" width="228" height="228" rx="26" fill="${GAP}" stroke="${INK}" stroke-width="6"/>
  ${inner}
</svg>`;

/* ---------- shared scene pieces ---------- */

// Patient's outer thigh along the right edge. Flat left edge at x=168 so a
// device tip drawn to x=168 lands exactly on the skin.
const leg = () => `
  <path d="M168 20 C168 12 176 8 190 8 C210 8 226 14 232 34 C238 58 236 82 230 100
           C238 130 236 165 226 195 C220 214 210 226 194 228 C178 230 168 220 168 200 Z"
        fill="${LEGF}" stroke="${INK}" stroke-width="5"/>
  <path d="M176 186q24 9 48 2" stroke="${INK}" stroke-width="3" opacity="0.18" fill="none"/>`;

// Solid fist gripping a VERTICAL device at (cx, cy). Fill-only union of
// knuckle mass + slanted wrist + thumb bump; finger gaps drawn on top.
const fistV = (cx, cy) => `
  <g fill="${HAND}">
    <rect x="${cx - 38}" y="${cy - 36}" width="76" height="70" rx="26"/>
    <circle cx="${cx - 34}" cy="${cy - 10}" r="13"/>
    <rect x="${cx + 1}" y="${cy + 18}" width="30" height="66" rx="15"
          transform="rotate(-16 ${cx + 16} ${cy + 18})"/>
  </g>
  <path d="M${cx - 30} ${cy - 17}h60M${cx - 30} ${cy - 1}h60M${cx - 30} ${cy + 15}h60"
        stroke="${GAP}" stroke-width="3" fill="none"/>`;

// Solid hand gripping a HORIZONTAL device from above (device tip at tipX,
// centered on cy). Forearm comes in from the left, fingers wrap down over
// the body, thumb tucks along the underside.
const handH = (tipX, cy) => {
  const cx = tipX - 68; // hand center over the device body
  return `
  <g fill="${HAND}">
    <rect x="${cx - 84}" y="${cy - 54}" width="66" height="34" rx="17"/>
    <rect x="${cx - 40}" y="${cy - 62}" width="78" height="88" rx="28"/>
    <rect x="${cx - 52}" y="${cy + 4}" width="56" height="21" rx="10.5"/>
  </g>
  <path d="M${cx - 18} ${cy - 52}v72M${cx - 2} ${cy - 52}v76M${cx + 14} ${cy - 52}v72"
        stroke="${GAP}" stroke-width="3" fill="none"/>`;
};

// Red-outline confirmation check, bottom-right.
const check = () => `
  <circle cx="182" cy="176" r="26" fill="#fff" stroke="${RED}" stroke-width="6"/>
  <path d="M170 176l9 9 16-18" stroke="${RED}" stroke-width="7" fill="none"/>`;

// Countdown clock, top-left; hand sweep duration matches the device's real
// hold time (set inline per frame).
const clock = (secs) => `
  <circle cx="66" cy="64" r="26" fill="#fff" stroke="${INK}" stroke-width="5"/>
  <path class="ga-clock-hand" style="transform-box:view-box;transform-origin:66px 64px;animation-duration:${secs}s"
        d="M66 64V48" stroke="${RED}" stroke-width="5"/>
  <circle cx="66" cy="64" r="3.5" fill="${RED}"/>`;

// Phone with 911, bottom-right, for the remove-and-call frames.
const phone = () => `
  <g class="ga-ring" style="transform-box:fill-box;transform-origin:center">
    <rect x="146" y="112" width="60" height="94" rx="16" fill="#fff" stroke="${INK}" stroke-width="5"/>
    <path d="M163 138c2-4 7-5 10-2l4 4c2 2 2 5 0 7l-2 2c3 5 7 9 12 12l2-2c2-2 5-2 7 0l4 4c3 3 2 8-2 10-3 2-8 2-12 0-10-5-18-13-23-23-2-4-2-9 0-12z"
          fill="${RED}" transform="translate(2,-6) scale(0.82)" transform-origin="176 150"/>
    <text x="176" y="190" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif"
          font-weight="800" font-size="24" fill="${INK}">911</text>
  </g>
  <path d="M120 96q14-14 22-6" stroke="${RED}" stroke-width="4" stroke-dasharray="1 9" fill="none"/>`;

// Up arrow for pull-off steps (fade-cycled by ga-cap-arrow).
const upArrow = (x, y) => `
  <g class="ga-cap-arrow">
    <path d="M${x} ${y + 34}V${y + 4}M${x - 11} ${y + 15}L${x} ${y + 2}l11 13"
          stroke="${INK}" stroke-width="6" fill="none"/>
  </g>`;

const downArrow = (x, y) => `
  <g class="ga-cap-arrow">
    <path d="M${x} ${y}v30M${x - 11} ${y + 19}L${x} ${y + 32}l11-13"
          stroke="${INK}" stroke-width="6" fill="none"/>
  </g>`;

// Red impact marks radiating from the tip-to-skin contact point.
const burst = (x, y) => `
  <g class="ga-burst" style="transform-box:fill-box;transform-origin:center">
    <path d="M${x - 4} ${y - 24}l-7-11M${x - 18} ${y}h-13M${x - 4} ${y + 24}l-7 11"
          stroke="${RED}" stroke-width="5" fill="none"/>
  </g>`;

/* ---------- device renderings ---------- */

// EpiPen, upright: ivory tube, blue safety cap on top, orange needle end at
// the bottom, label window on the body.
const epiV = ({ capOn = true } = {}) => `
  <rect x="84" y="34" width="40" height="110" rx="15" fill="${IVORY}" stroke="${INK}" stroke-width="4"/>
  <rect x="94" y="50" width="20" height="42" rx="6" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
  <rect x="89" y="142" width="30" height="20" rx="9" fill="${ORANGE}" stroke="${INK}" stroke-width="4"/>
  ${capOn ? `<rect x="91" y="14" width="26" height="24" rx="9" fill="${BLUE}" stroke="${INK}" stroke-width="4"/>` : ''}`;

// EpiPen, horizontal, needle end reaching tipX: blue cap far left, orange
// tip at the leg.
const epiH = (tipX, cy) => `
  <rect x="10" y="${cy - 14}" width="24" height="28" rx="9" fill="${BLUE}" stroke="${INK}" stroke-width="4"/>
  <rect x="32" y="${cy - 18}" width="116" height="36" rx="15" fill="${IVORY}" stroke="${INK}" stroke-width="4"/>
  <rect x="44" y="${cy - 10}" width="40" height="20" rx="6" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
  <rect x="${tipX - 22}" y="${cy - 16}" width="22" height="32" rx="8" fill="${ORANGE}" stroke="${INK}" stroke-width="4"/>`;

// Auvi-Q, upright: compact red block, speaker at the top, viewing window,
// BLACK base (the end that goes to the thigh) at the bottom.
const auviV = () => `
  <rect x="82" y="34" width="44" height="114" rx="10" fill="${AQRED}" stroke="${INK}" stroke-width="4"/>
  <rect x="82" y="34" width="44" height="20" rx="10" fill="${INK}"/>
  <path d="M92 45h8M104 45h8" stroke="#fff" stroke-width="2.5"/>
  <rect x="92" y="66" width="24" height="30" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
  <rect x="82" y="134" width="44" height="14" fill="${INK}" stroke="${INK}" stroke-width="4"/>`;

// Auvi-Q, horizontal, black end reaching tipX.
const auviH = (tipX, cy) => `
  <rect x="34" y="${cy - 20}" width="116" height="40" rx="10" fill="${AQRED}" stroke="${INK}" stroke-width="4"/>
  <rect x="34" y="${cy - 20}" width="18" height="40" rx="10" fill="${INK}"/>
  <rect x="60" y="${cy - 11}" width="26" height="22" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
  <rect x="${tipX - 20}" y="${cy - 18}" width="20" height="36" rx="6" fill="${INK}" stroke="${INK}" stroke-width="4"/>`;

// Adrenaclick / generic, upright: gray body, gray cap "1" on top, gray cap
// "2" on the bottom; red needle tip revealed once cap 2 is off.
const adrenaV = ({ cap1 = true, cap2 = true, redTip = false } = {}) => `
  <rect x="84" y="40" width="40" height="108" rx="13" fill="${ACGRAY}" stroke="${INK}" stroke-width="4"/>
  ${redTip ? `<rect x="90" y="140" width="28" height="16" rx="7" fill="${RED}" stroke="${INK}" stroke-width="4"/>` : ''}
  ${cap1 ? `<rect x="88" y="20" width="32" height="26" rx="9" fill="${ACCAP}" stroke="${INK}" stroke-width="4"/>` : ''}
  ${cap2 ? `<rect x="88" y="142" width="32" height="26" rx="9" fill="${ACCAP}" stroke="${INK}" stroke-width="4"/>` : ''}`;

// Adrenaclick, horizontal, red tip reaching tipX.
const adrenaH = (tipX, cy) => `
  <rect x="30" y="${cy - 18}" width="118" height="36" rx="13" fill="${ACGRAY}" stroke="${INK}" stroke-width="4"/>
  <rect x="${tipX - 22}" y="${cy - 15}" width="22" height="30" rx="7" fill="${RED}" stroke="${INK}" stroke-width="4"/>`;

// Numbered step badge for the two Adrenaclick caps.
const badge = (n, x, y) => `
  <circle cx="${x}" cy="${y}" r="15" fill="${ACCAP}" stroke="${INK}" stroke-width="4"/>
  <text x="${x}" y="${y + 6}" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif"
        font-weight="800" font-size="17" fill="${INK}">${n}</text>`;

/* ---------- frames ---------- */

export const illustrations = {

  /* — EpiPen / EpiPen Jr — */

  confirm: () => frame(`
    ${epiV()}
    ${fistV(104, 96)}
    ${check()}
  `),

  cap: () => frame(`
    <g class="ga-cap">
      <rect x="91" y="26" width="26" height="24" rx="9" fill="${BLUE}" stroke="${INK}" stroke-width="4"/>
    </g>
    <rect x="84" y="58" width="40" height="90" rx="15" fill="${IVORY}" stroke="${INK}" stroke-width="4"/>
    <rect x="94" y="70" width="20" height="34" rx="6" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
    <rect x="89" y="148" width="30" height="18" rx="8" fill="${ORANGE}" stroke="${INK}" stroke-width="4"/>
    ${fistV(104, 118)}
    ${upArrow(164, 26)}
  `),

  thigh: () => frame(`
    ${leg()}
    <g class="ga-approach">
      ${epiH(160, 126)}
      ${handH(160, 126)}
    </g>
  `),

  push: () => frame(`
    ${leg()}
    <g class="ga-jab">
      ${epiH(168, 126)}
      ${handH(168, 126)}
    </g>
    ${burst(168, 126)}
  `),

  hold: () => frame(`
    ${leg()}
    ${epiH(168, 126)}
    ${handH(168, 126)}
    ${clock(3)}
  `),

  remove: () => frame(`
    <g class="ga-lift" style="transform-box:fill-box;transform-origin:center">
      <g transform="rotate(-32 78 108)">
        ${epiV({ capOn: false })}
        ${fistV(104, 96)}
      </g>
    </g>
    ${phone()}
  `),

  /* — Auvi-Q — */

  'aq-confirm': () => frame(`
    ${auviV()}
    ${fistV(104, 100)}
    ${check()}
  `),

  'aq-case': () => frame(`
    <g class="ga-cap">
      <rect x="78" y="16" width="52" height="26" rx="10" fill="${AQRED}" stroke="${INK}" stroke-width="4"/>
    </g>
    <g transform="translate(0,14)">
      ${auviV()}
      ${fistV(104, 104)}
    </g>
    ${upArrow(164, 18)}
    <path d="M142 78q10 8 0 16M152 70q16 14 0 30" stroke="${INK}" stroke-width="4" fill="none" class="ga-push-arrow"/>
  `),

  'aq-guard': () => frame(`
    <g transform="translate(0,-10)">
      ${auviV()}
      ${fistV(104, 92)}
    </g>
    <rect x="86" y="156" width="36" height="16" rx="7" fill="${AQRED}" stroke="${INK}" stroke-width="4"/>
    ${downArrow(160, 150)}
  `),

  'aq-thigh': () => frame(`
    ${leg()}
    <g class="ga-approach">
      ${auviH(160, 126)}
      ${handH(160, 126)}
    </g>
  `),

  'aq-press': () => frame(`
    ${leg()}
    <g class="ga-jab">
      ${auviH(168, 126)}
      ${handH(168, 126)}
    </g>
    ${burst(168, 126)}
  `),

  'aq-hold': () => frame(`
    ${leg()}
    ${auviH(168, 126)}
    ${handH(168, 126)}
    ${clock(2)}
  `),

  'aq-remove': () => frame(`
    <g class="ga-lift" style="transform-box:fill-box;transform-origin:center">
      <g transform="rotate(-32 78 108)">
        ${auviV()}
        ${fistV(104, 100)}
      </g>
    </g>
    ${phone()}
  `),

  /* — Adrenaclick / generic — */

  'ac-confirm': () => frame(`
    ${adrenaV()}
    ${fistV(104, 98)}
    ${check()}
  `),

  'ac-cap1': () => frame(`
    <g class="ga-cap">
      <rect x="88" y="24" width="32" height="26" rx="9" fill="${ACCAP}" stroke="${INK}" stroke-width="4"/>
    </g>
    <g transform="translate(0,12)">
      ${adrenaV({ cap1: false })}
      ${fistV(104, 100)}
    </g>
    ${upArrow(164, 22)}
    ${badge(1, 52, 42)}
  `),

  'ac-cap2': () => frame(`
    <g transform="translate(0,-12)">
      ${adrenaV({ cap1: false, cap2: false, redTip: true })}
      ${fistV(104, 88)}
    </g>
    <rect x="88" y="158" width="32" height="20" rx="8" fill="${ACCAP}" stroke="${INK}" stroke-width="4"/>
    ${downArrow(160, 152)}
    ${badge(2, 52, 166)}
  `),

  'ac-thigh': () => frame(`
    ${leg()}
    <g class="ga-jab">
      ${adrenaH(168, 126)}
      ${handH(168, 126)}
    </g>
    ${burst(168, 126)}
  `),

  'ac-hold': () => frame(`
    ${leg()}
    ${adrenaH(168, 126)}
    ${handH(168, 126)}
    ${clock(10)}
  `),

  'ac-remove': () => frame(`
    <g class="ga-lift" style="transform-box:fill-box;transform-origin:center">
      <g transform="rotate(-32 78 108)">
        ${adrenaV({ cap1: false, cap2: false })}
        ${fistV(104, 98)}
      </g>
    </g>
    ${phone()}
  `),
};

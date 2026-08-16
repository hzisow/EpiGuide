// Shared model → UI glue. Keeps the honesty guardrail in one place: real users
// only ever see a CATEGORY + urgency (see URGENCY_COPY); the raw probability,
// the per-symptom weight breakdown, and which rule escalated the verdict are
// rendered ONLY behind the hidden ?debug flag.

import { EPIGUIDE_MODEL } from './model.js';

// Hidden DEBUG gate — open the app with ?debug=1 to reveal the raw model output.
// Ships off: real users never pass the flag, so they never see a number.
export function isDebugMode() {
  return new URLSearchParams(location.search).has('debug');
}

// Category → plain-language verdict copy, keyed by the model's urgency level.
// No percentages, no "diagnosis" language — just what to do next.
export const URGENCY_COPY = {
  'act-now': {
    title: 'Signs of a severe reaction',
    action: 'Use epinephrine now and call 911.',
  },
  'caution': {
    title: 'Possible reaction — don’t wait',
    action: 'Prepare to act. Keep checking symptoms.',
  },
  'low': {
    title: 'These signs are less typical',
    action: 'Keep watching — anaphylaxis usually affects more than one body system.',
  },
};

// Human-readable names for the three routes that can escalate a verdict.
// See scoreWithSafetyOverride in js/model.js.
const ESCALATION_COPY = {
  'model': 'model above threshold',
  'niaid-faan-2006': 'NIAID/FAAN 2006 criteria',
  'wao-2020': 'WAO 2020 criteria',
  'red-flag': 'red-flag sign',
};

// Build the hidden debug panel: raw probability, which rule fired, and the
// sorted contribution bars. Rendered as a self-contained dark "console" card so
// it reads the same over the checklist's light background and the camera
// sheet's dark one.
export function debugPanelHTML(result) {
  const pct = (result.probability * 100).toFixed(1);
  const prob = result.probability.toFixed(4);

  // Scale bars against the largest ABSOLUTE weight. Some weights are negative
  // (collapse, diarrhoea, abdominal pain) because those signs genuinely argue
  // against anaphylaxis on their own — see the note in js/model.js. Scaling on
  // the raw max would render those as negative-width bars.
  const maxWeight = Math.max(...Object.values(EPIGUIDE_MODEL.weights).map(Math.abs));

  const bars = result.contributions.length
    ? result.contributions.map((c) => {
        const w = (Math.abs(c.weight) / maxWeight) * 100;
        const against = c.weight < 0;
        const fill = against
          ? 'background:linear-gradient(90deg,#ff8787,#ffa8a8);'
          : '';
        const sign = c.weight >= 0 ? '+' : '−';
        return `
          <div class="debug-bar"${against ? ' title="argues against anaphylaxis"' : ''}>
            <div class="debug-bar__label">${c.label}</div>
            <div class="debug-bar__track"><div class="debug-bar__fill" style="width:${w.toFixed(0)}%;${fill}"></div></div>
            <div class="debug-bar__weight" style="${against ? 'color:#ffa8a8;' : ''}">${sign}${Math.abs(c.weight).toFixed(3)}</div>
          </div>`;
      }).join('')
    : '<div class="debug-panel__empty">No symptoms set — intercept only.</div>';

  // Which of the three escalation routes actually fired. This is the honest
  // version of the verdict: it says the criteria caught something the model
  // missed, rather than letting the model take credit for the catch.
  const routes = (result.escalatedBy || []).map((k) => ESCALATION_COPY[k] || k);
  const escalation = routes.length
    ? `<div class="debug-panel__flag">▲ Escalated by: ${routes.join(' · ')}${
        result.redFlags && result.redFlags.length
          ? ` (${result.redFlags.join(', ')})`
          : ''
      }</div>`
    : '';

  const m = EPIGUIDE_MODEL.meta;

  return `
    <div class="debug-panel" aria-hidden="true">
      <div class="debug-panel__head">
        <span class="debug-panel__tag">DEBUG</span>
        <span class="debug-panel__prob">p = ${prob} · ${pct}%</span>
      </div>
      ${escalation}
      <div class="debug-panel__bars">${bars}</div>
      <div class="debug-panel__note">
        Prototype decision support, not a clinical diagnosis.
        Fitted on registry-derived synthetic cases; validated on ${m.validatedOn}
        at sensitivity ${m.shippedSensitivity} / specificity ${m.shippedSpecificity}
        (${m.benchmarkName}: ${m.benchmarkSensitivity} / ${m.benchmarkSpecificity}).
        Method: train/METHODS.md
      </div>
    </div>`;
}

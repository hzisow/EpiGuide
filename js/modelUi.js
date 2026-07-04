// Shared model → UI glue. Keeps the honesty guardrail in one place: real users
// only ever see a CATEGORY + urgency (see URGENCY_COPY); the raw probability and
// per-symptom weight breakdown are rendered ONLY behind the hidden ?debug flag.

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

// Build the hidden debug panel: raw probability + sorted contribution bars.
// Rendered as a self-contained dark "console" card so it reads the same over the
// checklist's light background and the camera sheet's dark one.
export function debugPanelHTML(result) {
  const pct = (result.probability * 100).toFixed(1);
  const prob = result.probability.toFixed(4);

  // Scale bars against the largest single weight in the model so the strongest
  // signs (collapse, LOC, stridor) read as full-width.
  const maxWeight = Math.max(...Object.values(EPIGUIDE_MODEL.weights));
  const bars = result.contributions.length
    ? result.contributions.map((c) => {
        const w = (c.weight / maxWeight) * 100;
        return `
          <div class="debug-bar">
            <div class="debug-bar__label">${c.label}</div>
            <div class="debug-bar__track"><div class="debug-bar__fill" style="width:${w.toFixed(0)}%"></div></div>
            <div class="debug-bar__weight">+${c.weight.toFixed(3)}</div>
          </div>`;
      }).join('')
    : '<div class="debug-panel__empty">No symptoms set — intercept only.</div>';

  const override = result.safetyOverride
    ? '<div class="debug-panel__flag">⚠ Safety override applied (red-flag sign)</div>'
    : '';

  return `
    <div class="debug-panel" aria-hidden="true">
      <div class="debug-panel__head">
        <span class="debug-panel__tag">DEBUG</span>
        <span class="debug-panel__prob">p = ${prob} · ${pct}%</span>
      </div>
      ${override}
      <div class="debug-panel__bars">${bars}</div>
      <div class="debug-panel__note">Prototype model output — registry-modeled, not clinical.</div>
    </div>`;
}

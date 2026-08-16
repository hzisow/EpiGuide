// Screen 5 — Checklist. Manual symptom fallback off Recognize. The result card is
// now driven by the model in js/model.js (fitted on registry-derived synthetic
// cases, validated on real published cases): checked items are mapped
// to model feature keys, scored with the safety override, and shown as a CATEGORY
// + urgency. The raw probability + weight breakdown appear ONLY behind ?debug.

import { state, navigate, logIncidentEventOnce } from '../app.js';
import { icons } from '../icons.js';
import { checklistCategories, checklistToModelState, ageBands } from '../data/checklistItems.js';
import { scoreWithSafetyOverride } from '../model.js';
import { isDebugMode, URGENCY_COPY, debugPanelHTML } from '../modelUi.js';

let root, built = false;

export function initChecklist() {
  root = document.querySelector('.screen[data-screen="checklist"]');
  if (!built) build();
  logIncidentEventOnce('start', 'Symptom check started');
  // Restore checked state from app state.
  syncFromState();
  updateResult();
}

function build() {
  root.innerHTML = `
    <div class="checklist" style="flex:1;display:flex;flex-direction:column;position:relative;">
      <div class="checklist__head">
        <span class="eyebrow">Manual symptom check</span>
        <h1 class="h1" style="margin-top:6px;">Does this match anaphylaxis?</h1>
        <p class="body-sm honesty-line">Prototype decision support. Not a medical device. In an emergency, call 911.</p>
      </div>
      <div class="scroll-y checklist__body" id="cl-body"></div>
      <div class="checklist__result" id="cl-result"></div>
    </div>`;

  const body = root.querySelector('#cl-body');
  const ageHTML = `
    <div class="checklist__group" data-cat="age">
      <div class="eyebrow checklist__group-label">Who has symptoms?</div>
      <div class="segmented segmented--light" role="tablist" aria-label="Age group" id="cl-age">
        ${ageBands.map((b) => `
          <button type="button" role="tab" data-age="${b.id}"
                  aria-selected="${b.id === state.checklist.ageBand}">
            ${b.label}<span class="segmented__sub">${b.sub}</span>
          </button>`).join('')}
      </div>
    </div>`;

  body.innerHTML = ageHTML + checklistCategories.map((cat) => `
    <div class="checklist__group" data-cat="${cat.id}">
      <div class="eyebrow checklist__group-label">${cat.label}</div>
      ${cat.items.map((item) => `
        <label class="check-row">
          <input type="checkbox" data-item="${item.id}" data-cat="${cat.id}">
          <span class="check-box">${icons.check()}</span>
          <span class="check-label">${item.label}</span>
        </label>`).join('')}
    </div>`).join('');

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('#cl-age button[data-age]');
    if (!btn) return;
    state.checklist.ageBand = btn.dataset.age;
    root.querySelectorAll('#cl-age button[data-age]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.age === state.checklist.ageBand));
    });
    updateResult();
  });

  body.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const id = cb.dataset.item;
    const set = new Set(state.checklist.checkedItemIds);
    if (cb.checked) set.add(id); else set.delete(id);
    state.checklist.checkedItemIds = [...set];
    updateResult();
  });

  built = true;
}

function syncFromState() {
  const checked = new Set(state.checklist.checkedItemIds);
  root.querySelectorAll('#cl-body input[type="checkbox"]').forEach((cb) => {
    cb.checked = checked.has(cb.dataset.item);
  });
  root.querySelectorAll('#cl-age button[data-age]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.age === state.checklist.ageBand));
  });
}

function scoreChecklist() {
  const modelState = checklistToModelState(state.checklist.checkedItemIds, state.checklist.ageBand);
  return scoreWithSafetyOverride(modelState);
}

function updateResult() {
  const result = scoreChecklist();
  const copy = URGENCY_COPY[result.urgency];
  const el = root.querySelector('#cl-result');
  const debug = isDebugMode() ? debugPanelHTML(result) : '';

  if (result.urgency === 'act-now' || result.urgency === 'caution') {
    logIncidentEventOnce('symptoms-identified', 'Symptoms consistent with possible anaphylaxis identified');
  }

  if (result.urgency === 'act-now') {
    el.innerHTML = `
      <div class="result-card result-card--urgent">
        <div class="result-card__head">
          ${icons.checkCircle('icon')}
          <div>
            <div class="result-card__title">${result.category}</div>
            <div class="result-card__sub">${copy.action}</div>
          </div>
        </div>
        <button class="btn btn--on-red btn--block" id="cl-continue">Continue to Guide</button>
      </div>${debug}`;
    wireContinue(el);
  } else if (result.urgency === 'caution') {
    el.innerHTML = `
      <div class="result-card result-card--caution">
        <div class="result-card__head">
          ${icons.alertTriangle('icon')}
          <div>
            <div class="result-card__title">${result.category}</div>
            <div class="result-card__sub">${copy.action}</div>
          </div>
        </div>
        <button class="btn btn--primary btn--block" id="cl-continue">Continue to Guide</button>
      </div>${debug}`;
    wireContinue(el);
  } else {
    // Deliberately calm, non-alarming state — not a grayed-out urgent card.
    el.innerHTML = `
      <div class="result-card result-card--calm">
        <div class="result-card__head">
          ${icons.list('icon')}
          <div>
            <div class="result-card__title">Keep checking if more symptoms match</div>
            <div class="result-card__sub">${copy.action}</div>
          </div>
        </div>
      </div>${debug}`;
  }
}

function wireContinue(el) {
  el.querySelector('#cl-continue')?.addEventListener('click', () => {
    logIncidentEventOnce('proceed-to-guide', 'Proceeded to injection guide');
    state.guide.currentStep = 1;
    navigate('guide');
  });
}

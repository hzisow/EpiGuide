// Screen 5 — Checklist. Manual symptom fallback off Recognize. Result card is
// driven by how many CATEGORIES (not items) have at least one checked item.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { checklistCategories } from '../data/checklistItems.js';

let root, built = false;

export function initChecklist() {
  root = document.querySelector('.screen[data-screen="checklist"]');
  if (!built) build();
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
      </div>
      <div class="scroll-y checklist__body" id="cl-body"></div>
      <div class="checklist__result" id="cl-result"></div>
    </div>`;

  const body = root.querySelector('#cl-body');
  body.innerHTML = checklistCategories.map((cat) => `
    <div class="checklist__group" data-cat="${cat.id}">
      <div class="eyebrow checklist__group-label">${cat.label}</div>
      ${cat.items.map((item) => `
        <label class="check-row">
          <input type="checkbox" data-item="${item.id}" data-cat="${cat.id}">
          <span class="check-box">${icons.check()}</span>
          <span class="check-label">${item.label}</span>
        </label>`).join('')}
    </div>`).join('');

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
}

function countCategories() {
  const checked = new Set(state.checklist.checkedItemIds);
  return checklistCategories.filter((cat) =>
    cat.items.some((item) => checked.has(item.id))
  ).length;
}

function updateResult() {
  const n = countCategories();
  const result = root.querySelector('#cl-result');

  if (n >= 2) {
    result.innerHTML = `
      <div class="result-card result-card--urgent">
        <div class="result-card__head">
          ${icons.checkCircle('icon')}
          <div>
            <div class="result-card__title">Matches anaphylaxis criteria</div>
            <div class="result-card__sub">Symptoms across ${n} body systems — treat now</div>
          </div>
        </div>
        <button class="btn btn--on-red btn--block" id="cl-continue">Continue to Guide</button>
      </div>`;
    result.querySelector('#cl-continue').addEventListener('click', () => {
      state.guide.currentStep = 1;
      navigate('guide');
    });
  } else {
    // Deliberately calm, non-alarming state — not a grayed-out urgent card.
    result.innerHTML = `
      <div class="result-card result-card--calm">
        <div class="result-card__head">
          ${icons.list('icon')}
          <div>
            <div class="result-card__title">Keep checking if more symptoms match</div>
            <div class="result-card__sub">Anaphylaxis usually affects more than one part of the body.</div>
          </div>
        </div>
      </div>`;
  }
}

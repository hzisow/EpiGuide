// Screen 3 — Guide. Full-screen, one-step-at-a-time illustrated walkthrough,
// branched by DEVICE (EpiPen/EpiPen Jr, Auvi-Q, Adrenaclick/generic) — the steps,
// animations, and hold time differ per injector. The device is chosen either
// automatically (from the injector a responding volunteer carries, set in
// volunteerCard) or by the patient via the picker.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { guides, DEVICE_ORDER } from '../data/guideSteps.js';
import { illustrations } from '../illustrations.js';

let root, built = false;
let countdownTimer = null;

export function initGuide() {
  root = document.querySelector('.screen[data-screen="guide"]');
  if (!built) build();
  clearCountdown();
  // No device chosen yet → ask which injector before showing steps.
  if (!state.guide.device || !guides[state.guide.device]) {
    renderPicker();
  } else {
    renderStep();
  }
}

function build() {
  root.innerHTML = `
    <div class="guide" style="flex:1;display:flex;flex-direction:column;">
      <div class="guide__head">
        <div class="guide__eyebrow">
          <span class="eyebrow" id="guide-eyebrow">Step 1 of 6</span>
          <div class="guide__head-actions">
            <button class="guide__device" id="guide-device" hidden></button>
            <button class="icon-btn" id="guide-replay" aria-label="Replay animation">${icons.replay()}</button>
          </div>
        </div>
        <div class="guide__progress"><div class="progress" id="guide-progress"></div></div>
      </div>
      <div class="guide__stage" id="guide-stage"></div>
      <div class="guide__foot" id="guide-foot"></div>
    </div>`;

  root.querySelector('#guide-replay').addEventListener('click', () => renderStep());
  root.querySelector('#guide-device').addEventListener('click', renderPicker);

  built = true;
}

// Ask which auto-injector the user has — the steps differ per device.
function renderPicker() {
  clearCountdown();
  root.querySelector('.guide').classList.remove('guide--hold');
  root.querySelector('#guide-eyebrow').textContent = 'Your device';
  root.querySelector('#guide-device').hidden = true;
  root.querySelector('#guide-progress').innerHTML = '';

  const stage = root.querySelector('#guide-stage');
  stage.innerHTML = `
    <div class="guide__stage-inner guide__picker">
      <h1 class="h2">Which auto-injector do you have?</h1>
      <p class="body-sm text-muted">The steps are different for each. Pick the one in your hand.</p>
      <div class="guide__picker-list">
        ${DEVICE_ORDER.map((d) => `
          <button class="guide__picker-btn" data-device="${d}">
            <span>${guides[d].label}</span>
            <span class="guide__picker-chevron" aria-hidden="true">›</span>
          </button>`).join('')}
      </div>
    </div>`;
  root.querySelector('#guide-foot').innerHTML = '';

  stage.querySelectorAll('[data-device]').forEach((b) =>
    b.addEventListener('click', () => {
      state.guide.device = b.dataset.device;
      state.guide.deviceLocked = true; // user's explicit choice wins over auto-match
      state.guide.currentStep = 1;
      renderStep();
    }));
}

function steps() {
  return guides[state.guide.device].steps;
}

function renderStep() {
  const all = steps();
  const total = all.length;
  let n = state.guide.currentStep;
  if (n < 1) n = 1;
  if (n > total) n = total;
  const step = all[n - 1];

  root.querySelector('#guide-eyebrow').textContent = `Step ${n} of ${total}`;

  // Device chip — shows which injector's guide this is; tap to change.
  const chip = root.querySelector('#guide-device');
  chip.hidden = false;
  chip.innerHTML = `${guides[state.guide.device].label} <span aria-hidden="true">▾</span>`;

  // Progress segments (rebuilt to match this device's step count).
  const prog = root.querySelector('#guide-progress');
  if (prog.children.length !== total) {
    prog.innerHTML = all.map(() => '<div class="progress__seg"></div>').join('');
  }
  prog.querySelectorAll('.progress__seg').forEach((seg, i) => {
    seg.classList.toggle('progress__seg--filled', i < n);
  });

  // Compact the layout on the hold step so the countdown ring fits without scroll.
  root.querySelector('.guide').classList.toggle('guide--hold', !!step.isHold);

  const stage = root.querySelector('#guide-stage');
  stage.innerHTML = `
    <div class="guide__stage-inner" key="${state.guide.device}-${n}">
      <div class="guide__art">${illustrations[step.illustrationKey]()}</div>
      <h1 class="display guide__headline">${step.headline}</h1>
      <p class="body-sm text-muted">${step.subline}</p>
    </div>`;

  const foot = root.querySelector('#guide-foot');
  clearCountdown();

  if (step.isHold) {
    renderHold(step, foot);
  } else {
    const isLast = n === total;
    foot.innerHTML = `<button class="btn btn--primary btn--block" id="guide-next">${isLast ? 'Done' : 'Next Step'}</button>`;
    foot.querySelector('#guide-next').addEventListener('click', advance);
  }
}

function renderHold(step, foot) {
  const total = step.holdSeconds;
  const C = 2 * Math.PI * 54; // circumference for r=54
  foot.innerHTML = `
    <div class="countdown">
      <div class="countdown__ring">
        <svg viewBox="0 0 120 120">
          <circle class="countdown__track" cx="60" cy="60" r="54"></circle>
          <circle class="countdown__progress" id="cd-prog" cx="60" cy="60" r="54"
                  stroke-dasharray="${C}" stroke-dashoffset="0"></circle>
        </svg>
        <div class="countdown__num" id="cd-num">${total}</div>
      </div>
      <p class="body-sm text-muted">Keep holding…</p>
    </div>`;

  const prog = foot.querySelector('#cd-prog');
  const num = foot.querySelector('#cd-num');
  let remaining = total;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    prog.style.transition = `stroke-dashoffset ${total * 1000}ms linear`;
    requestAnimationFrame(() => { prog.style.strokeDashoffset = String(C); });
  } else {
    prog.style.strokeDashoffset = String(C);
  }

  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      num.textContent = '0';
      clearCountdown();
      setTimeout(advance, 350);
    } else {
      num.textContent = String(remaining);
    }
  }, 1000);
}

function advance() {
  const total = steps().length;
  if (state.guide.currentStep >= total) {
    // Completing the last step: record the epinephrine timestamp, go to Dispatch.
    state.dispatch.epinephrineGivenAt = new Date();
    state.guide.currentStep = 1; // reset for next run (keep the chosen device)
    navigate('dispatch');
    return;
  }
  state.guide.currentStep += 1;
  renderStep();
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// Screen 3 — Guide. Full-screen, one-step-at-a-time illustrated walkthrough.
// Pure UI/state, zero external dependency. Step 5 is a 3s hold countdown.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { guideSteps } from '../data/guideSteps.js';
import { illustrations } from '../illustrations.js';

let root, built = false;
let countdownTimer = null;

export function initGuide() {
  root = document.querySelector('.screen[data-screen="guide"]');
  if (!built) build();
  clearCountdown();
  // Guide always resumes from its current step (reset to 1 when entering fresh
  // from Recognize/Checklist — those set state.guide.currentStep = 1).
  renderStep();
}

function build() {
  root.innerHTML = `
    <div class="guide" style="flex:1;display:flex;flex-direction:column;">
      <div class="guide__head">
        <div class="guide__eyebrow">
          <span class="eyebrow" id="guide-eyebrow">Step 1 of 6</span>
          <button class="icon-btn" id="guide-replay" aria-label="Replay animation">${icons.replay()}</button>
        </div>
        <div class="guide__progress"><div class="progress" id="guide-progress"></div></div>
      </div>
      <div class="guide__stage" id="guide-stage"></div>
      <div class="guide__foot" id="guide-foot"></div>
    </div>`;

  // Progress segments (6).
  const prog = root.querySelector('#guide-progress');
  prog.innerHTML = guideSteps.map(() => '<div class="progress__seg"></div>').join('');

  root.querySelector('#guide-replay').addEventListener('click', () => {
    // Re-trigger the step-in animation.
    renderStep();
  });

  built = true;
}

function renderStep() {
  const n = state.guide.currentStep;
  const step = guideSteps[n - 1];

  root.querySelector('#guide-eyebrow').textContent = `Step ${n} of 6`;

  // Progress fill.
  root.querySelectorAll('#guide-progress .progress__seg').forEach((seg, i) => {
    seg.classList.toggle('progress__seg--filled', i < n);
  });

  const stage = root.querySelector('#guide-stage');
  stage.innerHTML = `
    <div class="guide__stage-inner" key="${n}">
      <div class="guide__art">${illustrations[step.illustrationKey]()}</div>
      <h1 class="display guide__headline">${step.headline}</h1>
      <p class="body-sm text-muted">${step.subline}</p>
    </div>`;

  const foot = root.querySelector('#guide-foot');
  clearCountdown();

  if (step.isHold) {
    renderHold(step, foot);
  } else {
    const isLast = n === guideSteps.length;
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
  // Drive the ring: animate stroke-dashoffset to full over total seconds.
  if (!reduceMotion) {
    prog.style.transition = `stroke-dashoffset ${total * 1000}ms linear`;
    // next frame so transition applies
    requestAnimationFrame(() => { prog.style.strokeDashoffset = String(C); });
  } else {
    prog.style.strokeDashoffset = String(C);
  }

  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      num.textContent = '0';
      clearCountdown();
      // Brief beat, then advance.
      setTimeout(advance, 350);
    } else {
      num.textContent = String(remaining);
    }
  }, 1000);
}

function advance() {
  if (state.guide.currentStep >= guideSteps.length) {
    // Completing step 6: record the epinephrine timestamp, go to Dispatch.
    state.dispatch.epinephrineGivenAt = new Date();
    state.guide.currentStep = 1; // reset for next run
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

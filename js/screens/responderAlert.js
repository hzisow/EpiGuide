// Screen 6 — Responder Alert (SIMULATED / demo mode). Shown to a nearby opt-in
// carrier with spare epinephrine. Requires a second real device to be live, so
// this is a scripted demo screen — not wired to any backend.

import { navigate } from '../app.js';
import { icons } from '../icons.js';

let root, built = false;

export function initResponderAlert() {
  root = document.querySelector('.screen[data-screen="responderAlert"]');
  if (!built) build();
}

function build() {
  root.innerHTML = `
    <div class="responder" style="flex:1;">
      <div class="responder__inner">
        <div class="alert-bell">
          <span class="alert-bell__ring"></span>
          <span class="alert-bell__ring"></span>
          <span class="alert-bell__core">${icons.bell()}</span>
        </div>
        <h1 class="h1">Someone near you needs epinephrine</h1>
        <p class="body text-muted" style="margin-top:8px;">0.2 mi away · Sent 8 seconds ago</p>

        <div class="card info-card">
          <div class="info-row">${icons.mapPin()}<span>412 Main St, Lobby</span></div>
          <div class="info-row">${icons.clock()}<span>Estimated 3 min walk</span></div>
          <div class="info-row">${icons.user()}<span>Adult, possible anaphylaxis</span></div>
        </div>

        <div class="responder__actions">
          <button class="btn btn--primary btn--block" id="ra-help">${icons.navigation()} I can help — Navigate</button>
          <button class="btn btn--secondary btn--block" id="ra-cant">Can't make it</button>
        </div>
        <p class="responder__caption">Your response helps close the gap before EMS arrives.</p>
      </div>
    </div>`;

  root.querySelector('#ra-help').addEventListener('click', () => navigate('firstResponderView'));
  root.querySelector('#ra-cant').addEventListener('click', () => {
    // Return to a neutral/idle state — back to Find.
    navigate('find');
  });

  built = true;
}

// Screen 9 — Incident Summary. A bystander-facing record generated AFTER the
// handoff to EMS: the full timeline, the device used, the symptoms observed,
// and the address, in one place the bystander (or the patient, later) can
// keep, share, or re-read. Distinct from Medic Handoff (screen 8), which is
// live, EMS-facing, and disappears the moment EMS takes over — this is the
// bystander's own copy for follow-up care, insurance, or their own records.
//
// HONESTY NOTE: every line here is built from REAL state captured elsewhere
// in the app (real timestamps, real checked symptoms, real device, real
// GPS). Nothing is invented, and the screen says plainly that it is a
// bystander-recorded account, not an official medical record.

import { state, navigate, resetIncident } from '../app.js';
import { icons } from '../icons.js';
import { reverseGeocode } from '../map.js';
import { checklistCategories } from '../data/checklistItems.js';
import { guides } from '../data/guideSteps.js';

const ALL_ITEMS = checklistCategories.flatMap((c) => c.items);

let root, built = false;

export function initIncidentSummary() {
  root = document.querySelector('.screen[data-screen="incidentSummary"]');
  if (!built) build();
  render();
}

function build() {
  root.innerHTML = `
    <div class="incident" style="flex:1;display:flex;flex-direction:column;">
      <div class="appbar">
        <button class="icon-btn" id="is-back" aria-label="Back">${icons.chevronLeft()}</button>
        <span class="appbar__title">Incident summary</span>
      </div>
      <div class="scroll-y incident__body" id="is-body" style="flex:1;padding:0 var(--space-4) var(--space-6);"></div>
      <div class="incident__foot" style="padding:0 var(--space-4) max(var(--space-5), env(safe-area-inset-bottom));">
        <button class="btn btn--dark btn--block" id="is-share">${icons.share()} Share summary</button>
        <button class="btn btn--ghost" id="is-new" style="margin:12px auto 0;display:block;">Start a new incident</button>
      </div>
    </div>`;

  root.querySelector('#is-back').addEventListener('click', () => navigate('medicHandoff'));
  root.querySelector('#is-share').addEventListener('click', shareSummary);
  root.querySelector('#is-new').addEventListener('click', () => {
    if (!confirm('Start a new incident? This clears the current timeline, symptoms, and device selection.')) return;
    resetIncident();
    navigate('find');
  });

  built = true;
}

function render() {
  const body = root.querySelector('#is-body');
  const epi = state.dispatch.epinephrineGivenAt;
  const deviceLabel = state.guide.device ? guides[state.guide.device]?.label : null;
  const ids = state.checklist.checkedItemIds || [];
  const symptomLabels = ids.map((id) => ALL_ITEMS.find((i) => i.id === id)?.label).filter(Boolean);
  const events = [...state.incident.events].sort((a, b) => a.time - b.time);
  const today = new Date();

  body.innerHTML = `
    <p class="body-sm text-muted" style="margin:var(--space-4) 0 var(--space-3);">${formatDate(today)}</p>

    <div class="card">
      <div class="summary-row">
        <span class="eyebrow label">Epinephrine given</span>
        <span class="value">${epi ? `${formatTime(epi)}${deviceLabel ? ` · ${deviceLabel}` : ''}` : 'Not given'}</span>
      </div>
      <div class="summary-row">
        <span class="eyebrow label">Symptoms observed</span>
        <span class="value">${symptomLabels.length ? symptomLabels.join(', ') : 'Not recorded'}</span>
      </div>
      <div class="summary-row">
        <span class="eyebrow label">Location</span>
        <span class="value" id="is-addr">${state.location ? 'Locating address…' : 'Not recorded'}</span>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <span class="eyebrow">Timeline</span>
      <div class="timeline" style="margin-top:var(--space-3);">
        ${events.length ? events.map((e) => `
          <div class="timeline__row">
            <div class="timeline__rail"><span class="timeline__dot"></span></div>
            <div class="timeline__content">
              <div class="timeline__time">${formatTime(e.time)}</div>
              <div class="timeline__label">${e.label}</div>
            </div>
          </div>`).join('') : '<p class="body-sm text-muted">No events recorded yet.</p>'}
      </div>
    </div>

    <p class="body-sm honesty-line">Bystander-recorded summary for your own records — not an official medical record. For documentation, use EMS or hospital paperwork.</p>`;

  if (state.location) {
    reverseGeocode(state.location.lat, state.location.lng).then((addr) => {
      const el = root.querySelector('#is-addr');
      if (el) el.textContent = addr || `${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}`;
    });
  }
}

async function shareSummary() {
  const epi = state.dispatch.epinephrineGivenAt;
  const deviceLabel = state.guide.device ? guides[state.guide.device]?.label : null;
  const ids = state.checklist.checkedItemIds || [];
  const symptomLabels = ids.map((id) => ALL_ITEMS.find((i) => i.id === id)?.label).filter(Boolean);
  const events = [...state.incident.events].sort((a, b) => a.time - b.time);

  const lines = [
    `Incident summary — ${formatDate(new Date())}`,
    '',
    `Epinephrine given: ${epi ? `${formatTime(epi)}${deviceLabel ? ` (${deviceLabel})` : ''}` : 'Not given'}`,
    `Symptoms observed: ${symptomLabels.length ? symptomLabels.join(', ') : 'Not recorded'}`,
    '',
    'Timeline:',
    ...(events.length ? events.map((e) => `  ${formatTime(e.time)} — ${e.label}`) : ['  No events recorded']),
    '',
    'Bystander-recorded summary — not an official medical record.',
  ];
  const text = lines.join('\n');

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Incident summary', text });
      return;
    }
  } catch (_) {
    return; // user dismissed the share sheet
  }
  // Fallback where the Web Share API isn't available: copy to clipboard.
  try {
    await navigator.clipboard.writeText(text);
    const btn = root.querySelector('#is-share');
    const original = btn.innerHTML;
    btn.innerHTML = `${icons.checkCircle()} Copied to clipboard`;
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  } catch (_) {
    // No share, no clipboard — nothing more we can do silently.
  }
}

function formatTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Shared "Alert nearby volunteers" card. Its home is the Find screen — the
// moment someone realizes there's no auto-injector on hand, they can summon a
// volunteer who carries one. Dispatch re-mounts the same card as a live status
// panel once an alert is out.
//
// net.js (Supabase) stays lazily imported so the core flow works offline.

import { state, logIncidentEventOnce } from './app.js';
import { icons } from './icons.js';
import { injectorToDevice, guides } from './data/guideSteps.js';

let netP;
const net = () => (netP ||= import('./net.js'));

const responders = new Map(); // responder_id -> latest response row
let unsub = null;
let activeContainer = null;   // most recently mounted card owns the UI

export function mountVolunteerCard(container, { lead } = {}) {
  activeContainer = container;
  container.innerHTML = `
    <div class="card vol-card">
      <div class="vol-card__head">
        <span class="eyebrow" style="color:var(--color-blue);">Nearby volunteers</span>
        <span class="pill pill--blue">Live network</span>
      </div>
      <p class="body-sm text-muted" data-vol-status>
        ${lead || 'No auto-injector on hand? Alert people nearby who carry epinephrine and have opted in to help.'}
      </p>
      <div class="vol-list" data-vol-list></div>
      <button class="btn btn--vol btn--block" data-vol-btn>${icons.bell()} Alert nearby volunteers</button>
    </div>`;

  container.querySelector('[data-vol-btn]').addEventListener('click', () => raise(container));

  // An alert already went out earlier in this session — show live status.
  if (state.activeAlert) attach(container, state.activeAlert).catch(() => {});

  return () => { if (unsub) { unsub(); unsub = null; } };
}

async function raise(container) {
  const btn = container.querySelector('[data-vol-btn]');
  const status = container.querySelector('[data-vol-status]');
  btn.setAttribute('aria-disabled', 'true');
  btn.innerHTML = `${icons.bell()} Alerting…`;
  try {
    const n = await net();
    const coords = state.location || await n.getPosition();
    const note = state.recognize?.result === 'match'
      ? 'Likely anaphylaxis — needs epinephrine'
      : 'Possible anaphylaxis — needs epinephrine';
    state.activeAlert = await n.raiseAlert({ lat: coords.lat, lng: coords.lng, note });
    logIncidentEventOnce('alert-raised', 'Nearby responder network alerted');
    await attach(container, state.activeAlert);
  } catch (e) {
    btn.removeAttribute('aria-disabled');
    btn.innerHTML = `${icons.bell()} Alert nearby volunteers`;
    const msg = (e && e.message) || String(e);
    status.textContent = /denied|permission|location/i.test(msg)
      ? 'Location needed to alert nearby volunteers. Allow location and try again.'
      : 'Could not send the alert. Check your connection and try again.';
  }
}

// Bind this container to the active alert's live responses.
async function attach(container, alert) {
  container.querySelector('[data-vol-btn]').hidden = true;
  container.querySelector('[data-vol-status]').textContent =
    'Alert sent. Waiting for a nearby volunteer to respond…';
  const n = await net();
  responders.clear();
  if (unsub) unsub();
  unsub = n.subscribeToResponses(alert.id, (row) => {
    if (!row) return;
    responders.set(row.responder_id, row);
    render(n, alert);
  });
}

function render(n, alert) {
  const container = activeContainer;
  if (!container || !container.isConnected) return;
  const list = container.querySelector('[data-vol-list]');
  const status = container.querySelector('[data-vol-status]');
  if (!list || !status) return;

  const rows = [...responders.values()].filter((r) => r.status !== 'declined');
  if (rows.length === 0) {
    status.textContent = 'Alert sent. Waiting for a nearby volunteer to respond…';
    list.innerHTML = '';
    return;
  }
  status.textContent = `${rows.length} volunteer${rows.length > 1 ? 's' : ''} responding`;
  logIncidentEventOnce('responder-responding', 'A nearby volunteer responded to the alert');
  if (rows.some((r) => r.status === 'arrived')) {
    logIncidentEventOnce('responder-arrived', 'A volunteer arrived on scene');
  }

  // Auto-match the injection guide to the pen a responding volunteer is bringing,
  // so the patient's walkthrough is for the RIGHT device — unless the patient has
  // manually picked one, which always wins.
  if (!state.guide.deviceLocked) {
    const withPen = rows.find((r) => r.responder_injector && injectorToDevice(r.responder_injector));
    if (withPen) state.guide.device = injectorToDevice(withPen.responder_injector);
  }

  list.innerHTML = rows.map((r) => {
    let dist = '';
    if (r.responder_lat != null && r.responder_lng != null) {
      const mi = n.haversineMeters(alert.lat, alert.lng, r.responder_lat, r.responder_lng) / 1609.34;
      dist = ` · ${mi < 0.1 ? '< 0.1' : mi.toFixed(1)} mi`;
    }
    const label = r.status === 'arrived' ? 'Arrived' : 'On the way';
    const dev = injectorToDevice(r.responder_injector);
    const carrying = dev ? ` · ${guides[dev].label}` : '';
    return `<div class="vol-row"><span class="vol-row__dot"></span>
      <span class="body-sm"><strong>Volunteer</strong> ${label}${dist}${carrying}</span></div>`;
  }).join('');
}

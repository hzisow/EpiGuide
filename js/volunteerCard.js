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

// How long we are willing to show "waiting for a volunteer" before saying
// plainly that nobody has come. Epinephrine is time-critical; a wait state with
// no end is a wait state that quietly tells the user help is on its way.
const RESPONSE_TIMEOUT_MS = 90000;
let waitTimer = null;

// What the card says while NOBODY has responded yet. render() falls back to
// this instead of re-asserting "waiting…", so a message that has already been
// downgraded to "call 911" can never be silently upgraded again.
let idle = { text: '', urgent: false };

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
  setIdle('Alert sent. Checking whether any volunteer nearby is available…');
  const n = await net();
  responders.clear();
  if (unsub) unsub();
  unsub = n.subscribeToResponses(alert.id, (row) => {
    if (!row) return;
    responders.set(row.responder_id, row);
    render(n, alert);
  });

  // Cached on the alert, so re-mounting the card (Find → Dispatch) doesn't
  // re-run the check or restart the clock.
  if (!alert.reach) alert.reach = await reachOf(n, alert);
  applyReach(alert);
}

// Did this alert actually reach anyone? Two sources, most trustworthy first.
async function reachOf(n, alert) {
  // 1) The server-side fan-out, which filtered on EXACT responder coordinates.
  //    Its explicit "nobody" reasons are authoritative; a nonzero notified count
  //    proves at least one device was reached.
  const f = alert.fanout;
  if (f && typeof f.reason === 'string' && /no available responders|no responders in range/i.test(f.reason)) {
    return { status: 'none', exact: true };
  }
  if (f && Number(f.notified) > 0) {
    return { status: 'some', exact: true, count: Number(f.notified) };
  }
  // 2) Otherwise fall back to the public responders table. Coarse (~1.1 km grid)
  //    and therefore approximate — applyReach() labels it as such.
  try {
    return await n.availabilityNear(alert.lat, alert.lng);
  } catch (_) {
    return { status: 'unknown', count: 0 };
  }
}

function applyReach(alert) {
  if (responders.size) return; // somebody already responded — render() owns the copy
  if (alert.reach?.status === 'some') {
    const c = alert.reach.count;
    // `notified` counts DEVICES reached, not people (one volunteer can have two),
    // so the exact branch says devices. The approximate branch counts distinct
    // rows in `responders`, i.e. people, but from coarse coordinates.
    const who = alert.reach.exact
      ? `${c} nearby device${c > 1 ? 's' : ''}`
      : `${c} volunteer${c > 1 ? 's' : ''} who may be nearby (their location is only approximate)`;
    setIdle(`Alert delivered to ${who}. Waiting for someone to respond — no one has yet.`);
    armTimeout(alert);
  } else if (alert.reach?.status === 'none') {
    // Deliberately "showing as available" and not "nobody is there": all we can
    // honestly report is what the network told us.
    setIdle('Alert sent, but no volunteer near you is showing as available. Don’t wait for one — call 911 now.', true);
    logIncidentEventOnce('alert-no-responders', 'No volunteer nearby was showing as available');
  } else {
    setIdle('Alert sent, but we couldn’t check whether any volunteer is nearby. Don’t wait — call 911 now.', true);
  }
}

// Anchored to when the alert was raised, not to when this card mounted, so
// moving between screens can't quietly restart the countdown.
function armTimeout(alert) {
  clearTimeout(waitTimer);
  const raisedAt = new Date(alert.created_at).getTime();
  const elapsed = Number.isFinite(raisedAt) ? Date.now() - raisedAt : 0;
  const left = RESPONSE_TIMEOUT_MS - elapsed;
  if (left <= 0) return expireWait();
  waitTimer = setTimeout(expireWait, left);
}

function expireWait() {
  clearTimeout(waitTimer); waitTimer = null;
  if (responders.size) return;
  setIdle('No volunteer has responded. Don’t wait — call 911.', true);
  logIncidentEventOnce('alert-unanswered', 'No volunteer had responded to the alert');
}

// Set the "nothing has responded yet" message and show it.
function setIdle(text, urgent = false) {
  idle = { text, urgent };
  paintStatus(text, urgent);
}

function paintStatus(text, urgent = false) {
  const status = activeContainer?.isConnected
    ? activeContainer.querySelector('[data-vol-status]') : null;
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('vol-status--urgent', urgent);
}

function render(n, alert) {
  const container = activeContainer;
  if (!container || !container.isConnected) return;
  const list = container.querySelector('[data-vol-list]');
  const status = container.querySelector('[data-vol-status]');
  if (!list || !status) return;

  const rows = [...responders.values()].filter((r) => r.status !== 'declined');
  if (rows.length === 0) {
    // Nobody (or nobody left) is coming — fall back to whatever the last honest
    // status was, never to a fresh "waiting…".
    paintStatus(idle.text, idle.urgent);
    list.innerHTML = '';
    return;
  }
  // A real responder is en route: the wait is over, so stop the countdown.
  clearTimeout(waitTimer); waitTimer = null;
  status.classList.remove('vol-status--urgent');
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

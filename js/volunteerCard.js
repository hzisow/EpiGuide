// Shared "Alert nearby volunteers" card. Its home is the Find screen — the
// moment someone realizes there's no auto-injector on hand, they can summon a
// volunteer who carries one. Dispatch re-mounts the same card as a live status
// panel once an alert is out.
//
// net.js (Supabase) stays lazily imported so the core flow works offline.

import { state, logIncidentEvent, logIncidentEventOnce } from './app.js';
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
let ctaLabel = 'Alert nearby volunteers';

// Set once an alert has been ended, so the card keeps saying so after it is
// re-mounted on the other screen. Cleared when a new alert is raised.
let endedNote = '';

// `cta` exists because the button's meaning changes with where the card sits.
// On Find it is "I have no pen, bring me one". On Dispatch the patient has
// already been injected, so the only honest reason to summon a volunteer is a
// SECOND dose — anaphylaxis can rebound and most people carry one pen. Saying
// "Alert nearby volunteers" there reads as nonsense seconds after injecting.
export function mountVolunteerCard(container, { lead, cta } = {}) {
  activeContainer = container;
  ctaLabel = cta || 'Alert nearby volunteers';
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
      <div class="vol-end" data-vol-end></div>
      <button class="btn btn--vol btn--block" data-vol-btn>${icons.bell()} ${ctaLabel}</button>
    </div>`;

  container.querySelector('[data-vol-btn]').addEventListener('click', () => raise(container));

  // An alert already went out earlier in this session — show live status.
  if (state.activeAlert) {
    attach(container, state.activeAlert).catch(() => {});
  } else if (endedNote) {
    // An alert was raised and then ended earlier this session. Say so, and leave
    // the button available: a second, separate emergency can still need one.
    setIdle(endedNote);
  }

  return () => { if (unsub) { unsub(); unsub = null; } };
}

async function raise(container) {
  const btn = container.querySelector('[data-vol-btn]');
  const status = container.querySelector('[data-vol-status]');
  btn.setAttribute('aria-disabled', 'true');
  btn.innerHTML = `${icons.bell()} Alerting…`;
  endedNote = '';
  paintEnd('');
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
    btn.innerHTML = `${icons.bell()} ${ctaLabel}`;
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

  // Offer a way to stand the alert down. Awaited separately so a failure here
  // can never stop the live status above from rendering.
  renderEndControls(n, alert).catch(() => {});

  // Cached on the alert, so re-mounting the card (Find → Dispatch) doesn't
  // re-run the check or restart the clock.
  if (!alert.reach) alert.reach = await reachOf(n, alert);
  applyReach(alert);
}

// ---------------------------------------------------------------------------
// Ending an alert
// ---------------------------------------------------------------------------
//
// Without this the alert stays 'active' forever: net.js exported resolveAlert()
// but nothing ever called it, so a volunteer who accepted stayed 'en_route' with
// no way to be stood down, potentially still walking over after EMS had arrived.
//
// Two things this UI is careful NOT to imply:
//   1. That anyone can end an alert. Only the signed-in raiser can — RLS says so
//      (see canResolveAlert in net.js), and an anonymously raised alert cannot be
//      ended by anybody. Where that's the case we say it plainly instead of
//      showing a button that would silently no-op.
//   2. That ending it TELLS the volunteers. It does not: the responder screens
//      never subscribe to the alert row, and RLS would filter the resolved row
//      out of realtime even if they did (see subscribeToAlerts in net.js).
async function renderEndControls(n, alert) {
  if (!(await n.canResolveAlert(alert))) {
    paintEnd(`<p class="vol-end__note">${alert.created_by
      ? 'This alert can’t be ended from this device.'
      : 'This alert was raised without signing in, so it can’t be ended from this device.'}
      If a volunteer is on the way, tell them in person when they arrive.</p>`);
    return;
  }

  paintEnd(`
    <p class="vol-end__note">Once help is here, end the alert so it stops standing as an open call.</p>
    <div class="vol-end__row">
      <button class="btn btn--secondary vol-end__btn" data-vol-resolve="resolved">EMS has arrived</button>
      <button class="btn btn--secondary vol-end__btn" data-vol-resolve="cancelled">Cancel alert</button>
    </div>
    <p class="vol-end__error" data-vol-end-error hidden></p>`);

  const host = activeContainer?.querySelector('[data-vol-end]');
  if (!host) return;
  host.querySelectorAll('[data-vol-resolve]').forEach((btn) => {
    btn.addEventListener('click', () => endAlert(n, alert, btn.dataset.volResolve));
  });
}

async function endAlert(n, alert, status) {
  const host = activeContainer?.querySelector('[data-vol-end]');
  if (!host) return;
  const btns = [...host.querySelectorAll('[data-vol-resolve]')];
  const errEl = host.querySelector('[data-vol-end-error]');
  const labels = btns.map((b) => b.textContent);
  btns.forEach((b) => { b.setAttribute('aria-disabled', 'true'); });
  if (errEl) errEl.hidden = true;

  try {
    await n.resolveAlert(alert.id, status);
  } catch (e) {
    // Visibly failed. The alert is still live and still shown as live — the one
    // outcome we must never produce is a resolve that looks like it worked.
    btns.forEach((b, i) => { b.removeAttribute('aria-disabled'); b.textContent = labels[i]; });
    if (errEl) {
      errEl.textContent = `Could not end the alert — it is still active. ${(e && e.message) || e}`;
      errEl.hidden = false;
    }
    return;
  }

  // Stop listening: this alert is over.
  if (unsub) { unsub(); unsub = null; }
  clearTimeout(waitTimer); waitTimer = null;
  responders.clear();
  state.activeAlert = null;

  logIncidentEvent(status === 'cancelled'
    ? 'Volunteer alert cancelled by the person who raised it'
    : 'Volunteer alert ended — EMS on scene');

  // Deliberately explicit that volunteers are NOT notified. Anything softer
  // would be the same class of bug this card is fixing.
  endedNote = status === 'cancelled'
    ? 'Alert cancelled. Any volunteer already on the way is not notified — tell them in person if you can.'
    : 'Alert ended. Any volunteer already on the way is not notified — tell them in person if you can.';
  setIdle(endedNote);
  const list = activeContainer?.querySelector('[data-vol-list]');
  if (list) list.innerHTML = '';
  paintEnd('');
  const btn = activeContainer?.querySelector('[data-vol-btn]');
  if (btn) { btn.hidden = false; btn.removeAttribute('aria-disabled'); btn.innerHTML = `${icons.bell()} ${ctaLabel}`; }
}

function paintEnd(html) {
  const host = activeContainer?.isConnected
    ? activeContainer.querySelector('[data-vol-end]') : null;
  if (host) host.innerHTML = html;
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

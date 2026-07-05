// The injection steps, as data, PER DEVICE. Different auto-injectors are used
// differently (cap mechanics, where the needle is, how long to hold), so the
// guide branches on the device the patient (or the responding volunteer) has.
//
// IMPORTANT: this copy — for EVERY device — requires physician sign-off
// (Dr. Cohen, Dr. Laidlaw) before shipping anywhere real. Hold times and cap
// mechanics are per current manufacturer instructions; if any copy changes
// during implementation, flag it to Henry for re-review.

export const guides = {
  epipen: {
    label: 'EpiPen / EpiPen Jr',
    steps: [
      { headline: 'Confirm and grab it', subline: 'Facial swelling, hives, or trouble breathing', isHold: false, holdSeconds: 0, illustrationKey: 'confirm' },
      { headline: 'Pull off the blue cap', subline: 'Grip firmly, pull straight back', isHold: false, holdSeconds: 0, illustrationKey: 'cap' },
      { headline: 'Orange tip to outer thigh', subline: 'Through clothing is fine', isHold: false, holdSeconds: 0, illustrationKey: 'thigh' },
      { headline: 'Push firmly until it clicks', subline: "You'll feel it lock into place", isHold: false, holdSeconds: 0, illustrationKey: 'push' },
      { headline: 'Hold for 3 seconds', subline: 'Keep the device steady against the leg', isHold: true, holdSeconds: 3, illustrationKey: 'hold' },
      { headline: 'Remove, then call 911', subline: 'Massage the site, note the time', isHold: false, holdSeconds: 0, illustrationKey: 'remove' },
    ],
  },

  'auvi-q': {
    label: 'Auvi-Q',
    steps: [
      { headline: 'Confirm and grab it', subline: 'Facial swelling, hives, or trouble breathing', isHold: false, holdSeconds: 0, illustrationKey: 'aq-confirm' },
      { headline: 'Pull off the outer case', subline: 'The device will start talking you through it', isHold: false, holdSeconds: 0, illustrationKey: 'aq-case' },
      { headline: 'Red end to outer thigh', subline: 'Never put your fingers on the red end', isHold: false, holdSeconds: 0, illustrationKey: 'aq-thigh' },
      { headline: 'Press firmly — it clicks', subline: 'The needle is inside; keep pressing', isHold: false, holdSeconds: 0, illustrationKey: 'aq-press' },
      { headline: 'Hold for 2 seconds', subline: 'Keep the device steady against the leg', isHold: true, holdSeconds: 2, illustrationKey: 'aq-hold' },
      { headline: 'Remove, then call 911', subline: 'Massage the site, note the time', isHold: false, holdSeconds: 0, illustrationKey: 'aq-remove' },
    ],
  },

  generic: {
    label: 'Adrenaclick / generic',
    steps: [
      { headline: 'Confirm and grab it', subline: 'Facial swelling, hives, or trouble breathing', isHold: false, holdSeconds: 0, illustrationKey: 'ac-confirm' },
      { headline: 'Remove the first grey cap', subline: 'Marked “1” — pull it straight off', isHold: false, holdSeconds: 0, illustrationKey: 'ac-cap1' },
      { headline: 'Remove the second grey cap', subline: 'Marked “2” — this exposes the red tip', isHold: false, holdSeconds: 0, illustrationKey: 'ac-cap2' },
      { headline: 'Red tip to outer thigh', subline: 'Press firmly until it clicks', isHold: false, holdSeconds: 0, illustrationKey: 'ac-thigh' },
      { headline: 'Hold for 10 seconds', subline: 'Keep the device steady against the leg', isHold: true, holdSeconds: 10, illustrationKey: 'ac-hold' },
      { headline: 'Remove, then call 911', subline: 'Massage the site, note the time', isHold: false, holdSeconds: 0, illustrationKey: 'ac-remove' },
    ],
  },
};

// Order shown in the device picker.
export const DEVICE_ORDER = ['epipen', 'auvi-q', 'generic'];

// Map a stored injector_type (responders/epipens) to a guide device family.
// Returns null for 'other'/unknown so the guide asks the user to pick.
export function injectorToDevice(injector) {
  if (injector === 'epipen' || injector === 'auvi-q' || injector === 'generic') return injector;
  return null;
}

// The 6 injection steps as data. Copy is verbatim from the build spec and MUST
// stay abstracted/flat in illustration (see identity note, Section 1).
//
// IMPORTANT: these exact 6 steps require physician sign-off (Dr. Cohen,
// Dr. Laidlaw) before shipping anywhere real. If the copy is ever changed
// during implementation, flag it to Henry for re-review.

export const guideSteps = [
  {
    id: 1,
    headline: 'Confirm and grab it',
    subline: 'Facial swelling, hives, or trouble breathing',
    isHold: false,
    holdSeconds: 0,
    illustrationKey: 'confirm',
  },
  {
    id: 2,
    headline: 'Pull off the blue cap',
    subline: 'Grip firmly, pull straight back',
    isHold: false,
    holdSeconds: 0,
    illustrationKey: 'cap',
  },
  {
    id: 3,
    headline: 'Place against outer thigh',
    subline: 'Through clothing is fine',
    isHold: false,
    holdSeconds: 0,
    illustrationKey: 'thigh',
  },
  {
    id: 4,
    headline: 'Push firmly until it clicks',
    subline: "You'll feel it lock into place",
    isHold: false,
    holdSeconds: 0,
    illustrationKey: 'push',
  },
  {
    id: 5,
    headline: 'Hold for 3 seconds',
    subline: 'Keep the device steady against the leg',
    isHold: true,
    holdSeconds: 3,
    illustrationKey: 'hold',
  },
  {
    id: 6,
    headline: 'Remove, then call 911',
    subline: 'Massage the site, note the time',
    isHold: false,
    holdSeconds: 0,
    illustrationKey: 'remove',
  },
];

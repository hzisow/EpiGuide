#!/usr/bin/env bash
# Commit the model work. Run from EpiGuide-ios/ on your Mac:
#     bash commit-models.sh
#
# This exists because the cloud session reaches your disk through a bridge that
# cannot delete files, and git needs to unlink .git/index.lock on every write.
# Every change is already on disk; only the committing is left.
set -euo pipefail

cd "$(dirname "$0")"

# Clear the stale zero-byte lock the blocked session left behind.
[ -f .git/index.lock ] && rm -f .git/index.lock

git config user.name "hzisow"
git config user.email "hzisow@gmail.com"

echo "on branch: $(git branch --show-current)"
echo

# ---------------------------------------------------------------- 1. pipeline
git add train .gitignore js/model.js
git commit -q -F - <<'MSG'
Train the symptom model from cited evidence instead of asserting its weights

js/model.js was 23 hand-placed numbers claiming accuracy 0.932 and ROC-AUC
0.986. Those figures came from fitting on synthetic cases and testing on more
synthetic cases from the same generator, which measures whether our own
simulator is learnable and nothing else. They are gone.

train/ now holds the whole chain: an evidence table naming a published source,
sample size and population for every symptom frequency it uses; a seeded
simulator; a scikit-learn fit; threshold calibration; and an export step that
writes js/model.js. That file is generated now and says so at the top, and
`make check` fails the build if anyone hand-edits it.

What replaced the old numbers is external validation against 44 real patients
from open-access published case reports, 27 with anaphylaxis and 17 with
conditions that mimic it, each coded from a verbatim quote and never seen
during fitting:

  fitted model alone         sensitivity 0.89  specificity 0.71
  shipped policy             sensitivity 1.00  specificity 0.41
  NIAID/FAAN 2006 criteria   sensitivity 0.81  specificity 0.71

The finding that shaped the design: on real cases the fitted model missed
anaphylaxis that the published clinical criteria caught. So it no longer
decides alone. Three routes can escalate and the loudest wins: a red-flag
sign, the clinical criteria, or the model above its calibrated threshold.
That trades specificity for sensitivity deliberately, because a miss can kill
someone and a false alarm costs an epinephrine dose and an ambulance.

Two errors found and fixed along the way, both recorded in train/METHODS.md.
The generator gave positives a named trigger whenever they had a known
exposure while negatives often had neither, so the model learned an artefact
of the sampler and trigger_venom became the largest weight in the model. And
our own NIAID/FAAN implementation counted cough as respiratory compromise,
which the published criteria never do, quietly making the benchmark more
sensitive than the rule it claims to implement.

Thresholds are calibrated on synthetic data only, never on the 44 real cases,
so the validation stays external.
MSG
echo "[1/3] pipeline committed"

# ------------------------------------------------------------------ 2. vision
git add js/hivesModel.js js/screens/recognize.js
git commit -q -F - <<'MSG'
Stop driving the camera verdict off a signal that fires on everything

Ran the shipped TF.js weights over 359 real SCIN images. The cue deciding
whether a skin reaction was present, 1 - P(normal_skin) >= 0.6, exceeded its
threshold on 98.6% of them, including 54 of the 59 images dermatologists
graded as showing no discernible pathology. Median value was 1.000 in every
group. It was a constant yes wearing a probability, and it was pushing
hives=1 into the symptom model on very nearly every scan.

The signal this file dismissed as unreliable turns out to be the good one. At
a 0.7 threshold P(hives) flagged half of dermatologist-labelled urticaria and
produced zero false positives across 209 non-urticaria images. It is not
unreliable, it is conservative, and conservative is what this cue needs: the
camera only ever adds evidence, so a false positive reaches the verdict while
a false negative costs nothing because the checklist covers it.

The old value is still returned and still shown in the debug panel rather
than deleted, so the failure stays visible.

Also corrects the licence. SCIN is not CC BY 4.0 as this file claimed; it is
a custom SCIN Data Use License with a re-identification clause.

Audit and training code in train/vision/. Outstanding: meta.json claims a
normal_skin class, but SCIN has no such class and no record survives of where
those images came from.
MSG
echo "[2/3] vision fix committed"

# ---------------------------------------------------------------- 3. features
git add js/app.js js/data/checklistItems.js js/screens/checklist.js css/components.css
git commit -q -F - <<'MSG'
Give every model feature something in the UI that can set it

Three of the 22 features had no control and sat at 0 in production: cough,
age_child and age_elderly. The model carried weights for them that nothing
could ever trigger.

Adds a cough checkbox and an age selector. Age is not cosmetic: on an
identical set of signs the model returns 0.70 for a child, 0.64 for an adult
and 0.51 for an older adult, which follows the registry data directly, where
angioedema is far less common in over-65s while loss of consciousness is far
more common. Adult is the default and sets no flag, so nothing changes for
anyone who does not touch the control.

Age applies on the camera path too, since it describes the patient rather
than how the signs were spotted.
MSG
echo "[3/3] feature wiring committed"

echo
git --no-pager log --oneline -3
echo
echo "Next:"
echo "  npm run build && npx cap sync ios   # sync www/ and the iOS bundle"
echo "  git push origin $(git branch --show-current)"

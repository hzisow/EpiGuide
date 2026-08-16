# EpiGuide: how the models were built

This document exists so that anyone can check our work instead of taking our
word for it. It covers where the numbers came from, what we had to assume, how
the models were tested, and what they cannot do.

Two models ship in EpiGuide, and they are very different objects.

| | Symptom model | Skin-reaction model |
|---|---|---|
| What it does | scores a checklist of signs | looks at skin through the camera |
| Type | logistic regression, 22 binary inputs | MobileNetV2 convolutional network |
| Parameters | 23 | ~2.3 million |
| Trained on | synthetic cases from published frequencies | 6,987 real photographs (SCIN registry, CC BY 4.0) |
| Framework | scikit-learn | TensorFlow / Keras, exported to TensorFlow.js |
| Runs as | plain arithmetic in the browser | TF.js graph model |
| Rebuild | `cd train && make all` | `cd train/vision && make all` |

---

## Part 1: the symptom model

### The short version

We could not get real patient data. Anaphylaxis datasets with symptom-level
detail are behind clinical data-use agreements that take months and credentialing
we do not have. So we did the next most defensible thing: we built a simulator
out of published symptom frequencies, fitted a model on it, and then tested that
model against **44 real patients from published case reports that it had never
seen**. The synthetic data is how the model learned. The real cases are how we
know whether it works.

### Why not just report accuracy on the synthetic data

Because that number is meaningless and we want to say so plainly. If you generate
cases from a set of frequencies, fit a model to them, and then test on more cases
from the same generator, you have measured whether your own simulator is
learnable. You could hit 0.99 AUC that way and it would tell you nothing about a
single real person.

An earlier version of this model reported accuracy 0.932 and ROC-AUC 0.986 from
exactly that setup. Those numbers are gone. They are replaced by the internal
consistency figures below, clearly labelled as such, plus the real-case results
that actually matter.

Internal (synthetic) figures, for completeness and not as evidence of anything
clinical: holdout accuracy 0.90, holdout AUC 0.95, 5-fold CV AUC 0.95 ± 0.001.
Calibration on the synthetic holdout is good, with an expected calibration error
of 0.006, which means the predicted probability tracks the observed rate closely
within that simulated world. Within that world.

### Where the frequencies came from

Every rate in `train/data/symptom_frequencies.json` names its source, its sample
size, and its population. The main ones:

- **Cross-Canada Anaphylaxis Registry** (Khalaf 2025, n=1,135 adults presenting
  to Canadian emergency departments) is the primary source for per-symptom rates.
  We preferred it over the larger European registry on purpose: the European
  Anaphylaxis Registry is fed by tertiary allergy centres and states that it
  oversamples severe reactions, which inflates respiratory and cardiovascular
  rates relative to an ordinary emergency department.
- **European Anaphylaxis Registry** (Worm 2012/2014/2025, Aurich 2019,
  Francuzik 2019/2021, Hanschmann 2023, n up to 16,988) fills the gaps Khalaf
  does not record: dyspnoea, loss of consciousness, dizziness, abdominal pain,
  and the age and trigger modifiers.
- **Mimic conditions** come from a scatter of smaller studies: acute urticaria
  (Kulthanan 2008, n=79), vasovagal syncope (Babaei 2025, n=1,914), panic attack
  (Tunnell 2024, a narrative review we flag as low quality).

Each entry carries a `basis` field: `table` when it appears in a published table
or body text, `fig-read` when we digitised it off a chart, `proxy` when we
borrowed a related measure, and `assumed` when we could not find it at all.

### What we had to assume, stated plainly

The negative class is the weak part of this work and pretending otherwise would
be the easiest way to get caught.

**No published study reports the same symptom list across anaphylaxis and its
mimics.** There is no table anywhere giving the frequency of hives, wheeze,
vomiting and hypotension in acute gastroenteritis, or in asthma exacerbation, or
in mild food-allergic reactions that did not meet anaphylaxis criteria. In
gastroenteritis and asthma cohorts the defining symptoms are inclusion criteria,
so their published frequencies are ~100% by construction and useless as base
rates. We searched for this specifically and did not find it.

So several mimic profiles are our estimates, marked `assumed`, and the **mixture
weights over the seven mimic conditions have no source at all**. To show how much
this matters rather than assert that it doesn't, `evaluate.py` refits the entire
model with every assumed value scaled by 0.5 and by 1.5, and with the European
trigger distribution swapped for a US-weighted one. Sensitivity moves between
0.96 and 1.00 across all four variants. The conclusions do not rest on the
guesses, which is the only reason we are comfortable shipping them.

### An inconsistency we found in the source data

Building the simulator surfaced something we did not expect. The European
registry reports cardiovascular involvement in 72% of anaphylaxis cases, but the
per-symptom cardiovascular rates from the Canadian emergency-department registry
(dizziness 35%, hypotension 10.3%, loss of consciousness 20%) sum to 65%. Those
cannot both be right about the same population: you cannot cover 72% of cases
with symptoms that add to 65%.

The explanation is population, not error. The European registry oversamples
severe tertiary-referral cases; the Canadian one is all-comers to an emergency
department. We resolved it by treating organ-system involvement as a purely
latent variable used to induce realistic correlation between symptoms, never as
something observed, so the observable symptom rates stay exactly on their
published values. It is recorded here rather than smoothed over because a reader
combining these two sources would hit the same wall.

### A second correction: we had quietly improved our own benchmark

Our implementation of the NIAID/FAAN criteria counted cough as respiratory
compromise. The published criteria do not list it: the 2006 text says "dyspnea,
wheeze-bronchospasm, stridor, reduced PEF, and hypoxemia". Including cough made
the benchmark more sensitive than the rule it claims to implement, and a
benchmark you have secretly upgraded is not a benchmark.

Removing it moved NIAID/FAAN from sensitivity 0.85 / specificity 0.65 to
**0.81 / 0.71** on the real cases. Our shipped system's sensitivity was
unaffected at 1.00. So the correction made our comparison look better, which is
precisely why it is worth stating that we made it: the error had been running in
the direction that flattered the competition, not us.

Cough remains a model feature. It just does not satisfy a clinical criterion.

### A bug worth confessing

The first working version of the generator gave every positive case with a known
exposure a named trigger, while negative cases often had an exposure with no
named trigger. The model learned this immediately: `trigger_venom` came out as
the single largest weight in the entire model, at 3.56, larger than stridor,
collapse and loss of consciousness combined.

That was not a clinical finding. It was the model detecting an artefact of our
own sampler. We fixed it by routing both classes through the same two steps (did
the bystander notice an exposure; if so, could they name the category, at 80%
either way), and `trigger_venom` fell to 1.41 while `known_exposure` became the
dominant context feature, which is what a clinician would expect.

We mention it because it is exactly the failure mode that makes synthetic
training data dangerous, and because the only reason we caught it was checking
whether the fitted weights made clinical sense.

### Every feature is reachable

All 22 features can now be set from the app: 19 through symptom checkboxes and
`age_child` / `age_elderly` through an age selector on the checklist screen.
Nothing in the model sits permanently at zero.

Age is not cosmetic. On an identical set of signs the model returns 0.70 for a
child, 0.64 for an adult and 0.51 for an older adult, which follows the registry
data directly: angioedema is far less common in over-65s (33.8% versus 62.1% in
children) while loss of consciousness is far more common (33% versus 20%). Adult
is the default and sets no flag, so the previous behaviour is preserved for
anyone who does not touch the control.

### How the model was fitted

L2-regularised logistic regression, scikit-learn, C=1.0, seeded. Regularisation
matters here because rare features (stridor at 5.8%, diarrhoea at 3.9%) would
otherwise take extreme values fitted to a handful of generated cases.

**Why not TensorFlow.** This model has 22 inputs and one output. In Keras it
would be a single dense unit fitting the same 23 numbers, and then it would need
a ~900KB runtime to evaluate them in the browser. As plain arithmetic it needs
nothing, works offline, and every weight is a readable log-odds contribution that
the debug panel can show. TensorFlow earns its place on the vision model, where
there are 2.3 million parameters and a real convolutional network. Using it here
would be decoration. `train_symptom_model.py --framework both` fits the Keras
version anyway and reports the maximum weight disagreement, so the claim is
checkable rather than asserted.

### How the thresholds were chosen

This is a place where it would be easy to cheat without noticing. The two
decision thresholds are selected on the **synthetic holdout only**, before the
model ever touches the 44 real cases. Tuning them against the real cases would
quietly convert the validation set into a training set and make the reported
sensitivity worthless.

The two thresholds get different targets, because they do different jobs:

- **possible** ("do not wait") is set to the lowest probability that still
  reaches 95% sensitivity on the synthetic holdout. It landed at 0.11.
- **likely** ("act now", which tells someone to use epinephrine and call 911) is
  set to reach 90% specificity. It landed at 0.30.

Asymmetric on purpose. The default 0.5 threshold optimises accuracy, and accuracy
is not what matters when one error is a death and the other is an unnecessary
epinephrine dose.

### External validation: the part that counts

44 real patients from open-access published case reports: 27 with anaphylaxis, 17
with conditions that mimic it (ACE-inhibitor angioedema, hereditary angioedema,
scombroid poisoning, vasovagal syncope, vocal cord dysfunction, cold urticaria,
systemic mastocytosis, asthma exacerbation, and others).

Each case was coded into the 22 features from a **verbatim quote** of the symptom
description in the paper, and each quote was machine-verified as a substring of
the downloaded source text. Symptoms the paper does not mention are coded `null`,
never 0, and only collapsed to 0 at scoring time, because an unchecked box in the
app means "not observed" and never "absent". That mapping can only remove
evidence for anaphylaxis, so the sensitivity we report is a lower bound. The full
dataset with quotes and sources is in `train/data/validation_cases.json`.

Results on those 44 cases:

| System | Sensitivity | Specificity |
|---|---|---|
| Fitted model alone | 0.89 | 0.71 |
| **What ships (model OR criteria OR red flag)** | **1.00** | **0.41** |
| NIAID/FAAN 2006 criteria | 0.81 | 0.71 |
| WAO 2020 criteria | 0.93 | 0.53 |

With 27 positives, a sensitivity of 1.00 has a 95% confidence interval of
0.88–1.00. It is a small validation set and the intervals in
`out/validation_report.md` say so.

### The most important finding: our model is not the best instrument

On real cases, the fitted model alone missed anaphylaxis cases that the published
clinical criteria caught, and the criteria in turn missed cases the model caught. The honest response to that is not to bury it.
It is to stop letting the model decide alone.

So the shipped system escalates if **any** of three routes fire:

1. **a red-flag sign** (stridor, collapse, unresponsiveness, throat tightness)
2. **the clinical criteria** (NIAID/FAAN 2006 or WAO 2020)
3. **the model** above its calibrated threshold

That union reaches 1.00 sensitivity at 0.41 specificity. Trading specificity for
sensitivity is the correct direction here and it is a deliberate choice, not an
accident of tuning.

### Why `collapse` has a negative weight

It looks like a bug and it is not. Collapse on its own is more often vasovagal
syncope than anaphylaxis, so as evidence it genuinely lowers the probability of
anaphylaxis. The model is right.

But a person who has collapsed needs help regardless of the cause, so the
red-flag route escalates anyway. This is the whole design in one weight: **the
model estimates how likely anaphylaxis is, and it knows nothing about what a
mistake costs.** Those are different questions and the app answers them with
different machinery.

### What the false alarms actually were

Specificity of 0.41 means 10 of the 17 mimics were escalated. We report that
number unadjusted. But the errors are not equivalent, and the breakdown matters:

**Nine were conditions that needed emergency care anyway.** ACE-inhibitor
angioedema of the tongue is a recognised cause of death by asphyxiation.
Hereditary angioedema with bowel obstruction needs urgent specific therapy.
Syncope with sinus arrest warrants assessment. Systemic mastocytosis with
hypotension is one where epinephrine is genuinely indicated. Telling those people
to call for help was right advice about the wrong diagnosis.

**The genuinely unnecessary escalations** were the cutaneous-only cases: cold
urticaria, COVID-associated urticaria, dermatographism, contact dermatitis, a
negative food challenge, and vocal cord dysfunction. Those are the real cost and
the thing worth improving.

That split is our clinical judgment, not the source papers', recorded per case
with reasoning in `train/data/escalation_judgments.json`. We are not clinicians.
Every arguable case was tagged the way that makes our own numbers look worse.

### What this model cannot do

- It has never been used in a real emergency by anyone.
- It is not a medical device and has no regulatory clearance.
- It was fitted on simulated data. The 44-case validation is prototype-grade
  evidence, not a clinical trial.
- Published case reports are not a random sample; journals favour unusual
  presentations.
- Real-world use will include many people with nothing wrong at all, a group the
  validation set does not contain, so field precision will be lower than the PPV
  we report.
- The `collapse` checkbox says "sudden collapse", which a frightened bystander
  will read far more broadly than the measured hypotension the source data
  counted. Wording mismatches like this are a real source of error that no
  amount of modelling fixes.

---

## Part 2: the skin-reaction model

This one is a real convolutional network trained on real photographs, and
TensorFlow is the right tool for it.

- **Architecture**: MobileNetV2, transfer-learned, 224×224 input, 3 output
  classes (hives / other condition / normal skin).
- **Data**: ~6,987 images from the SCIN dermatology registry (CC BY 4.0).
- **Result**: validation accuracy 0.92 overall.

The important caveat is built into the app rather than hidden in a footnote. The
model's dependable axis is **visible skin reaction versus normal skin**, at 0.99
precision and recall on 1,389 held-out images. The finer **hives versus other
rash** split is not reliable, because urticaria genuinely looks like other rashes
and SCIN is roughly 10:1 imbalanced toward other conditions. So the app never
uses that split to drive a verdict; it appears only in the debug panel. See
`js/hivesModel.js`.

The camera path is also honest about not having run. If the scan never got a
steady look at a face, the app says the check did not run rather than reporting
"no signs detected", because those are different statements and only one of them
is true.

Training code and evaluation: `train/vision/`.

---

## Reproducing all of this

```bash
cd train
pip install -r requirements.txt
make all          # regenerates js/model.js from the frequency table
make check        # verifies the app's model.js matches the pipeline
```

`make all` is the only supported way to change the model's weights. `js/model.js`
is a generated file and says so at the top. Same seed plus same frequency table
gives identical weights, every time.

## Sources

The full reference list, with URLs and per-number provenance, is in
`train/data/symptom_frequencies.json` and `train/data/validation_cases.json`.
Primary sources for the criteria:

- Sampson HA, et al. Second symposium on the definition and management of
  anaphylaxis. *J Allergy Clin Immunol* 2006;117(2):391-397.
- Cardona V, et al. World Allergy Organization Anaphylaxis Guidance 2020.
  *World Allergy Organ J* 2020;13(10):100472.
- Campbell RL, et al. Evaluation of NIAID/FAAN criteria for the diagnosis of
  anaphylaxis in emergency department patients. *J Allergy Clin Immunol*
  2012;129(3):748-752.
- Loprinzi Brauer CE, et al. Prospective Validation of the NIAID/FAAN Criteria.
  *J Allergy Clin Immunol Pract* 2016;4(6):1220-1226.

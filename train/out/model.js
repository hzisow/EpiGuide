// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Regenerate with:  cd train && make all
// Source of truth:  train/data/symptom_frequencies.json  (every rate cited)
//                   train/src/train_symptom_model.py     (the fit)
//                   train/src/export_js.py               (this file's generator)
//
// Generated 2026-08-16 from git rev 944f0e8, seed 20240816.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODEL IS
//
// A logistic regression over 22 binary signs. It was fitted on a synthetic
// cohort drawn from published anaphylaxis symptom frequencies (European
// Anaphylaxis Registry, Cross-Canada Anaphylaxis Registry, and others; every
// rate names its source in the frequency table). No patient data was used to
// fit it, and it is not a clinically validated diagnostic.
//
// It was then validated against 44 real patient cases from open-access published
// case reports (27 anaphylaxis, 17 conditions that mimic it), which it never saw
// during fitting:
//
//   the model alone            sensitivity 0.89   specificity 0.71
//   what this file ships       sensitivity 1.00   specificity 0.41
//   NIAID/FAAN 2006 criteria   sensitivity 0.81   specificity 0.71   (the accepted clinical rule)
//
// 44 cases is a small validation set and those numbers carry wide confidence
// intervals. See train/out/validation_report.md for the intervals, the full
// per-case results, and the limitations.
//
// ---------------------------------------------------------------------------
// WHY THE MODEL IS NOT ALLOWED TO DECIDE ALONE
//
// On real cases the fitted model missed anaphylaxis the accepted clinical
// criteria caught. So it does not get the last word. Three routes can escalate,
// and the loudest wins (see scoreWithSafetyOverride):
//
//   1. a red-flag sign      stridor, collapse, unresponsiveness, throat tightness
//   2. clinical criteria    NIAID/FAAN 2006 or WAO 2020
//   3. the model            above its calibrated threshold
//
// This trades specificity for sensitivity on purpose. Missing anaphylaxis can
// kill someone. A false alarm costs an epinephrine dose and an ambulance.
//
// One weight makes this concrete: `collapse` carries a NEGATIVE weight. That is
// not a bug. Collapse on its own is more often vasovagal syncope than
// anaphylaxis, so it genuinely lowers the probability. But a collapsed person
// needs help regardless of cause, so the red-flag route escalates anyway. The
// model estimates likelihood; it knows nothing about what a mistake costs.
//
// ---------------------------------------------------------------------------
// HONESTY GUARDRAIL (do not remove)
//   Real users see a CATEGORY, never a raw probability. The number and the
//   weight breakdown appear only behind the hidden ?debug flag, for demos.
//   This is decision support in an emergency, not a diagnosis.
// ---------------------------------------------------------------------------

export const EPIGUIDE_MODEL = {
  intercept: -6.9878,
  weights: {
    // skin
    hives: 0.6396, lip_face_swelling: 1.2574, flushing: 0.3145, itching: 1.0554,
    // respiratory
    trouble_breathing: 0.6016, wheezing: 0.7553, throat_tightness: 2.2259, cough: 0.0152, stridor: 0.9821,
    // gastrointestinal
    vomiting: 1.2467, abdominal_pain: -0.4992, diarrhea: -0.6915,
    // cardiovascular
    dizziness: 1.6671, collapse: -0.3468, loss_of_consciousness: 1.3822,
    // context
    known_exposure: 2.9577, rapid_onset: 1.4994, trigger_food: -0.0246, trigger_venom: 1.41, trigger_drug: -0.7396, age_child: 0.2669, age_elderly: -0.5689,
  },
  thresholds: { likely: 0.326, possible: 0.1239 },
  meta: {
    fittedOn: 'synthetic cohort from published symptom frequencies',
    validatedOn: '44 real published patient cases (27 anaphylaxis / 17 mimics)',
    shippedSensitivity: 1.0,
    shippedSpecificity: 0.4118,
    modelOnlySensitivity: 0.8889,
    modelOnlySpecificity: 0.7059,
    benchmarkName: 'NIAID/FAAN 2006 criteria',
    benchmarkSensitivity: 0.8148,
    benchmarkSpecificity: 0.7059,
    seed: 20240816,
    gitRev: '944f0e8',
    generated: '2026-08-16',
    notClinicallyValidated: true,
  },
};

// Human-readable labels for the debug breakdown UI.
export const SYMPTOM_LABELS = {
  hives: "Hives",
  lip_face_swelling: "Lip/face swelling",
  flushing: "Flushing",
  itching: "Itching",
  trouble_breathing: "Trouble breathing",
  wheezing: "Wheezing",
  throat_tightness: "Throat tightness",
  cough: "Cough",
  stridor: "Stridor (noisy breathing)",
  vomiting: "Vomiting",
  abdominal_pain: "Stomach pain",
  diarrhea: "Diarrhea",
  dizziness: "Dizziness",
  collapse: "Collapse",
  loss_of_consciousness: "Loss of consciousness",
  known_exposure: "Known trigger exposure",
  rapid_onset: "Came on fast (<1hr)",
  trigger_food: "Trigger: food",
  trigger_venom: "Trigger: insect sting",
  trigger_drug: "Trigger: medication",
  age_child: "Child",
  age_elderly: "Elderly",
};

// Organ-system groupings, used by the clinical criteria below.
const SKIN_MUCOSAL = ['hives', 'lip_face_swelling', 'flushing', 'itching'];
const RESPIRATORY = ['trouble_breathing', 'wheezing', 'throat_tightness', 'stridor'];
const CARDIOVASCULAR = ['collapse', 'loss_of_consciousness', 'dizziness'];
const GASTROINTESTINAL = ['vomiting', 'abdominal_pain', 'diarrhea'];

const RED_FLAGS = ['stridor', 'collapse', 'loss_of_consciousness', 'throat_tightness'];

const anyOf = (state, keys) => keys.some((k) => Boolean(state[k]));

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

/**
 * NIAID/FAAN 2006 criteria (Sampson et al., J Allergy Clin Immunol 2006;117:391-397).
 * The accepted clinical rule. Criterion 3 needs a blood-pressure cuff, so it can
 * never fire here and is omitted rather than faked.
 */
export function niaidFaan(state) {
  const skin = anyOf(state, SKIN_MUCOSAL);
  const resp = anyOf(state, RESPIRATORY);
  const cardio = anyOf(state, CARDIOVASCULAR);
  const gi = anyOf(state, GASTROINTESTINAL);
  const systems = [skin, resp, cardio, gi].filter(Boolean).length;

  const c1 = skin && (resp || cardio);
  const c2 = Boolean(state.known_exposure) && Boolean(state.rapid_onset) && systems >= 2;
  return { positive: c1 || c2, criterion1: c1, criterion2: c2, systems };
}

/**
 * WAO 2020 amended criteria (Cardona et al., World Allergy Organ J 2020;13:100472).
 * Adds the case that matters most to a bystander: a reaction that skips the skin
 * entirely still counts if there is airway or circulatory involvement after a
 * known exposure.
 */
export function wao2020(state) {
  const skin = anyOf(state, SKIN_MUCOSAL);
  const c1 = skin && (anyOf(state, RESPIRATORY) || anyOf(state, CARDIOVASCULAR) || anyOf(state, GASTROINTESTINAL));
  const c2 = Boolean(state.known_exposure)
    && anyOf(state, ['collapse', 'wheezing', 'stridor', 'throat_tightness']);
  return { positive: c1 || c2, criterion1: c1, criterion2: c2 };
}

/**
 * Score a set of observed signs with the fitted model only.
 * @param {Object} state - featureName -> truthy/falsy. Missing means not observed.
 * @returns {{ probability:number, category:string, urgency:string, contributions:Array }}
 */
export function scoreAnaphylaxis(state) {
  const w = EPIGUIDE_MODEL.weights;
  let z = EPIGUIDE_MODEL.intercept;
  const contributions = [];

  for (const key in w) {
    if (!state[key]) continue;
    z += w[key];
    contributions.push({ key, label: SYMPTOM_LABELS[key] || key, weight: w[key] });
  }

  const probability = sigmoid(z);
  contributions.sort((a, b) => b.weight - a.weight);

  const { likely, possible } = EPIGUIDE_MODEL.thresholds;
  let category, urgency;
  if (probability >= likely) { category = 'Likely anaphylaxis'; urgency = 'act-now'; }
  else if (probability >= possible) { category = 'Possible \u2014 do not wait'; urgency = 'caution'; }
  else { category = 'Unlikely'; urgency = 'low'; }

  return { probability, category, urgency, contributions };
}

/**
 * What the app actually calls. The model, the published clinical criteria, and
 * the red-flag rule all get a vote, and the most urgent one wins.
 *
 * `escalatedBy` lists every route that fired, so the debug panel can show which
 * one drove the verdict instead of leaving it a black box.
 */
export function scoreWithSafetyOverride(state) {
  const result = scoreAnaphylaxis(state);
  result.escalatedBy = [];
  if (result.urgency === 'act-now') result.escalatedBy.push('model');

  const nf = niaidFaan(state);
  const wao = wao2020(state);
  if (nf.positive) result.escalatedBy.push('niaid-faan-2006');
  if (wao.positive) result.escalatedBy.push('wao-2020');
  if (nf.positive || wao.positive) {
    result.category = 'Likely anaphylaxis';
    result.urgency = 'act-now';
    result.criteriaMet = true;
  }

  const redFlags = RED_FLAGS.filter((k) => state[k]);
  if (redFlags.length) {
    result.category = 'Likely anaphylaxis';
    result.urgency = 'act-now';
    result.safetyOverride = true;
    result.redFlags = redFlags;
    result.escalatedBy.push('red-flag');
  }

  return result;
}

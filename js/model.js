/**
 * EpiGuide — anaphylaxis recognition model (drop-in, zero dependencies).
 *
 * This is a logistic-regression classifier trained on 12,000 cases modeled on
 * European Anaphylaxis Registry symptom frequencies (30+ published studies).
 * It runs as plain arithmetic — no ML library, no build step, no network.
 *
 * HONESTY GUARDRAIL (do not remove):
 *   Real users see a CATEGORY ("Likely / Possible / Unlikely"), never a raw %.
 *   The probability is a prototype signal from registry-modeled data — NOT a
 *   clinically validated diagnosis. The raw number + weight breakdown are exposed
 *   ONLY in debug mode (for demos/pitch), never in the normal emergency UI.
 *
 * Held-out evaluation (registry-grounded synthetic data, not real-world clinical):
 *   accuracy 0.932 · ROC-AUC 0.986 · 5-fold CV AUC 0.985 ± 0.001
 */

export const EPIGUIDE_MODEL = {
  intercept: -8.8352,
  weights: {
    // skin
    hives: 2.649, lip_face_swelling: 2.461, flushing: 1.422, itching: 1.798,
    // respiratory
    trouble_breathing: 2.034, wheezing: 1.450, throat_tightness: 2.451, cough: 1.118, stridor: 4.305,
    // gastrointestinal
    vomiting: 2.327, abdominal_pain: 0.496, diarrhea: 0.224,
    // cardiovascular
    dizziness: 1.755, collapse: 6.765, loss_of_consciousness: 5.569,
    // context
    known_exposure: 2.325, rapid_onset: 2.046,
    trigger_food: 0.751, trigger_venom: 1.265, trigger_drug: 0.531,
    age_child: 0.387, age_elderly: -0.169,
  },
  meta: { accuracy: 0.932, auc: 0.986, cvAuc: 0.985, nTrain: 9000, nTest: 3000, nCases: 12000 },
};

// Human-readable labels (for debug breakdown UI)
export const SYMPTOM_LABELS = {
  hives: "Hives", lip_face_swelling: "Lip/face swelling", flushing: "Flushing", itching: "Itching",
  trouble_breathing: "Trouble breathing", wheezing: "Wheezing", throat_tightness: "Throat tightness",
  cough: "Cough", stridor: "Stridor (noisy breathing)",
  vomiting: "Vomiting", abdominal_pain: "Stomach pain", diarrhea: "Diarrhea",
  dizziness: "Dizziness", collapse: "Collapse", loss_of_consciousness: "Loss of consciousness",
  known_exposure: "Known trigger exposure", rapid_onset: "Came on fast (<1hr)",
  trigger_food: "Trigger: food", trigger_venom: "Trigger: insect sting", trigger_drug: "Trigger: medication",
  age_child: "Child", age_elderly: "Elderly",
};

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

/**
 * Score a set of observed features.
 * @param {Object} state - map of featureName -> 0/1 (or true/false). Missing = 0.
 * @returns {{ probability:number, category:string, urgency:string, contributions:Array }}
 */
export function scoreAnaphylaxis(state) {
  const w = EPIGUIDE_MODEL.weights;
  let z = EPIGUIDE_MODEL.intercept;
  const contributions = [];

  for (const key in w) {
    const on = state[key] ? 1 : 0;
    if (on) {
      z += w[key];
      contributions.push({ key, label: SYMPTOM_LABELS[key] || key, weight: w[key] });
    }
  }
  const probability = sigmoid(z);
  contributions.sort((a, b) => b.weight - a.weight);

  // CATEGORY is what real users see. Bands chosen so a single mild sign stays low,
  // and multi-system / severe patterns escalate. Tunable.
  let category, urgency;
  if (probability >= 0.6) { category = "Likely anaphylaxis"; urgency = "act-now"; }
  else if (probability >= 0.35) { category = "Possible — do not wait"; urgency = "caution"; }
  else { category = "Unlikely"; urgency = "low"; }

  return { probability, category, urgency, contributions };
}

/**
 * SAFETY OVERRIDE (recommended): certain single signs are emergencies regardless
 * of the model's arithmetic. This is clinical common-sense, not the model — it
 * ensures the app never under-warns on an obvious airway/circulatory emergency.
 */
export function scoreWithSafetyOverride(state) {
  const result = scoreAnaphylaxis(state);
  const RED_FLAGS = ["stridor", "collapse", "loss_of_consciousness", "throat_tightness"];
  const anyRedFlag = RED_FLAGS.some((k) => state[k]);
  if (anyRedFlag && result.urgency !== "act-now") {
    result.category = "Likely anaphylaxis";
    result.urgency = "act-now";
    result.safetyOverride = true;
  }
  return result;
}

"""Generate js/model.js from the fitted artifact.

The app never gets hand-edited weights. This script is the only thing that writes
js/model.js, so the numbers running in the app are provably the output of the
pipeline, and `make all` regenerates them from the evidence table every time.

The exported API is unchanged from the previous hand-written version, so
js/screens/checklist.js, js/screens/recognize.js and js/modelUi.js keep working:
    EPIGUIDE_MODEL, SYMPTOM_LABELS, scoreAnaphylaxis, scoreWithSafetyOverride
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from features import FEATURES, HUMAN_LABELS
from niaid_faan import (SKIN_MUCOSAL, RESPIRATORY, CARDIOVASCULAR, GASTROINTESTINAL)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

GROUPS = [
    ("skin", ["hives", "lip_face_swelling", "flushing", "itching"]),
    ("respiratory", ["trouble_breathing", "wheezing", "throat_tightness", "cough", "stridor"]),
    ("gastrointestinal", ["vomiting", "abdominal_pain", "diarrhea"]),
    ("cardiovascular", ["dizziness", "collapse", "loss_of_consciousness"]),
    ("context", ["known_exposure", "rapid_onset", "trigger_food", "trigger_venom",
                 "trigger_drug", "age_child", "age_elderly"]),
]


def js_list(names) -> str:
    return ", ".join(f"'{n}'" for n in names)


def render(artifact: dict, validation: dict) -> str:
    w = artifact["weights"]
    th = artifact["thresholds"]
    t_likely = th["likely"]["threshold"]
    t_possible = th["possible"]["threshold"]

    ev = validation["evaluation"]
    ship = ev["shipped_policy_SHIPPED"]
    model_only = ev["model_alone"]
    bench = ev["niaid_faan_2006_BENCHMARK"]

    weight_lines = []
    for group, names in GROUPS:
        weight_lines.append(f"    // {group}")
        chunk = "    " + " ".join(f"{n}: {w[n]}," for n in names)
        weight_lines.append(chunk)
    weights_block = "\n".join(weight_lines)

    labels_block = "\n".join(
        f"  {f}: {json.dumps(HUMAN_LABELS[f])}," for f in FEATURES
    )

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    return f"""// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Regenerate with:  cd train && make all
// Source of truth:  train/data/symptom_frequencies.json  (every rate cited)
//                   train/src/train_symptom_model.py     (the fit)
//                   train/src/export_js.py               (this file's generator)
//
// Generated {stamp} from git rev {artifact.get('git_rev', 'unknown')}, seed {artifact.get('seed')}.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODEL IS
//
// A logistic regression over {len(FEATURES)} binary signs. It was fitted on a synthetic
// cohort drawn from published anaphylaxis symptom frequencies (European
// Anaphylaxis Registry, Cross-Canada Anaphylaxis Registry, and others; every
// rate names its source in the frequency table). No patient data was used to
// fit it, and it is not a clinically validated diagnostic.
//
// It was then validated against {ev['n_cases']} real patient cases from open-access published
// case reports ({ev['n_anaphylaxis']} anaphylaxis, {ev['n_not_anaphylaxis']} conditions that mimic it), which it never saw
// during fitting:
//
//   the model alone            sensitivity {model_only['sensitivity']:.2f}   specificity {model_only['specificity']:.2f}
//   what this file ships       sensitivity {ship['sensitivity']:.2f}   specificity {ship['specificity']:.2f}
//   NIAID/FAAN 2006 criteria   sensitivity {bench['sensitivity']:.2f}   specificity {bench['specificity']:.2f}   (the accepted clinical rule)
//
// {ev['n_cases']} cases is a small validation set and those numbers carry wide confidence
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

export const EPIGUIDE_MODEL = {{
  intercept: {artifact['intercept']},
  weights: {{
{weights_block}
  }},
  thresholds: {{ likely: {t_likely}, possible: {t_possible} }},
  meta: {{
    fittedOn: 'synthetic cohort from published symptom frequencies',
    validatedOn: '{ev['n_cases']} real published patient cases ({ev['n_anaphylaxis']} anaphylaxis / {ev['n_not_anaphylaxis']} mimics)',
    shippedSensitivity: {ship['sensitivity']},
    shippedSpecificity: {ship['specificity']},
    modelOnlySensitivity: {model_only['sensitivity']},
    modelOnlySpecificity: {model_only['specificity']},
    benchmarkName: 'NIAID/FAAN 2006 criteria',
    benchmarkSensitivity: {bench['sensitivity']},
    benchmarkSpecificity: {bench['specificity']},
    seed: {artifact.get('seed')},
    gitRev: '{artifact.get('git_rev', 'unknown')}',
    generated: '{stamp}',
    notClinicallyValidated: true,
  }},
}};

// Human-readable labels for the debug breakdown UI.
export const SYMPTOM_LABELS = {{
{labels_block}
}};

// Organ-system groupings, used by the clinical criteria below.
const SKIN_MUCOSAL = [{js_list(SKIN_MUCOSAL)}];
const RESPIRATORY = [{js_list(RESPIRATORY)}];
const CARDIOVASCULAR = [{js_list(CARDIOVASCULAR)}];
const GASTROINTESTINAL = [{js_list(GASTROINTESTINAL)}];

const RED_FLAGS = ['stridor', 'collapse', 'loss_of_consciousness', 'throat_tightness'];

const anyOf = (state, keys) => keys.some((k) => Boolean(state[k]));

function sigmoid(z) {{ return 1 / (1 + Math.exp(-z)); }}

/**
 * NIAID/FAAN 2006 criteria (Sampson et al., J Allergy Clin Immunol 2006;117:391-397).
 * The accepted clinical rule. Criterion 3 needs a blood-pressure cuff, so it can
 * never fire here and is omitted rather than faked.
 */
export function niaidFaan(state) {{
  const skin = anyOf(state, SKIN_MUCOSAL);
  const resp = anyOf(state, RESPIRATORY);
  const cardio = anyOf(state, CARDIOVASCULAR);
  const gi = anyOf(state, GASTROINTESTINAL);
  const systems = [skin, resp, cardio, gi].filter(Boolean).length;

  const c1 = skin && (resp || cardio);
  const c2 = Boolean(state.known_exposure) && Boolean(state.rapid_onset) && systems >= 2;
  return {{ positive: c1 || c2, criterion1: c1, criterion2: c2, systems }};
}}

/**
 * WAO 2020 amended criteria (Cardona et al., World Allergy Organ J 2020;13:100472).
 * Adds the case that matters most to a bystander: a reaction that skips the skin
 * entirely still counts if there is airway or circulatory involvement after a
 * known exposure.
 */
export function wao2020(state) {{
  const skin = anyOf(state, SKIN_MUCOSAL);
  const c1 = skin && (anyOf(state, RESPIRATORY) || anyOf(state, CARDIOVASCULAR) || anyOf(state, GASTROINTESTINAL));
  const c2 = Boolean(state.known_exposure)
    && anyOf(state, ['collapse', 'wheezing', 'stridor', 'throat_tightness']);
  return {{ positive: c1 || c2, criterion1: c1, criterion2: c2 }};
}}

/**
 * Score a set of observed signs with the fitted model only.
 * @param {{Object}} state - featureName -> truthy/falsy. Missing means not observed.
 * @returns {{{{ probability:number, category:string, urgency:string, contributions:Array }}}}
 */
export function scoreAnaphylaxis(state) {{
  const w = EPIGUIDE_MODEL.weights;
  let z = EPIGUIDE_MODEL.intercept;
  const contributions = [];

  for (const key in w) {{
    if (!state[key]) continue;
    z += w[key];
    contributions.push({{ key, label: SYMPTOM_LABELS[key] || key, weight: w[key] }});
  }}

  const probability = sigmoid(z);
  contributions.sort((a, b) => b.weight - a.weight);

  const {{ likely, possible }} = EPIGUIDE_MODEL.thresholds;
  let category, urgency;
  if (probability >= likely) {{ category = 'Likely anaphylaxis'; urgency = 'act-now'; }}
  else if (probability >= possible) {{ category = 'Possible \\u2014 do not wait'; urgency = 'caution'; }}
  else {{ category = 'Unlikely'; urgency = 'low'; }}

  return {{ probability, category, urgency, contributions }};
}}

/**
 * What the app actually calls. The model, the published clinical criteria, and
 * the red-flag rule all get a vote, and the most urgent one wins.
 *
 * `escalatedBy` lists every route that fired, so the debug panel can show which
 * one drove the verdict instead of leaving it a black box.
 */
export function scoreWithSafetyOverride(state) {{
  const result = scoreAnaphylaxis(state);
  result.escalatedBy = [];
  if (result.urgency === 'act-now') result.escalatedBy.push('model');

  const nf = niaidFaan(state);
  const wao = wao2020(state);
  if (nf.positive) result.escalatedBy.push('niaid-faan-2006');
  if (wao.positive) result.escalatedBy.push('wao-2020');
  if (nf.positive || wao.positive) {{
    result.category = 'Likely anaphylaxis';
    result.urgency = 'act-now';
    result.criteriaMet = true;
  }}

  const redFlags = RED_FLAGS.filter((k) => state[k]);
  if (redFlags.length) {{
    result.category = 'Likely anaphylaxis';
    result.urgency = 'act-now';
    result.safetyOverride = true;
    result.redFlags = redFlags;
    result.escalatedBy.push('red-flag');
  }}

  return result;
}}
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--app-js", type=Path, required=True,
                    help="path to the app's js/ directory (source of truth copy)")
    args = ap.parse_args()

    artifact = json.loads((OUT / "model_weights.json").read_text())
    validation = json.loads((OUT / "validation.json").read_text())

    js = render(artifact, validation)
    (OUT / "model.js").write_text(js)

    target = args.app_js / "model.js"
    target.write_text(js)
    print(f"wrote {target} ({len(js.splitlines())} lines)")
    print("run `npm run build` in the app to sync www/, then `npx cap sync ios`")


if __name__ == "__main__":
    main()

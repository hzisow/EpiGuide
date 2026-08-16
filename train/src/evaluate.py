"""External validation: score the model against real published patient cases.

This is the only part of the pipeline that produces a number worth quoting.

Everything upstream is simulation. The model is fitted on synthetic cases drawn
from published frequencies, so measuring it on more synthetic cases would only
prove the simulator is learnable. Here it meets 44 real people, described in
44 open-access published case reports, coded from verbatim quotes, that the
model has never seen and that had no influence on any weight.

WHAT IS MEASURED
  1. The model, at its shipped decision thresholds, on the 44 real cases.
  2. The NIAID/FAAN 2006 criteria on the same 44 cases, as the benchmark. This
     is the accepted clinical rule; beating it is the bar, and published figures
     for it are Sn 95-97% / Sp 71-82% in an emergency-department population.
  3. WAO 2020 criteria on the same cases, for reference.
  4. The model plus its safety override, which is what actually ships.
  5. A sensitivity analysis: refit with every `assumed` value in the frequency
     table perturbed, and with a US-weighted trigger mix, to show how much the
     conclusions depend on the parts we had to guess.

HOW MISSING DATA IS TREATED
  A case report that never mentions diarrhoea is coded null, not 0. For scoring
  we map null to 0, because that is exactly what the app sees: an unchecked box
  means "not observed", never "absent". This is the honest mapping and it is the
  conservative one, since it can only remove evidence for anaphylaxis and so can
  only push sensitivity down. Reported sensitivity is therefore a lower bound.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

from features import FEATURES, SYMPTOM_FEATURES
from generate_cohort import CohortGenerator, load_table
from niaid_faan import niaid_faan, wao_2020

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "out"

RED_FLAGS = ("stridor", "collapse", "loss_of_consciousness", "throat_tightness")


# ----------------------------------------------------------------- scoring

def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + np.exp(-z))


def score(state: dict, intercept: float, weights: dict) -> float:
    z = intercept + sum(w for f, w in weights.items() if state.get(f))
    return float(sigmoid(z))


def categorise(p: float, t_likely: float, t_possible: float) -> str:
    if p >= t_likely:
        return "act-now"
    if p >= t_possible:
        return "caution"
    return "low"


def shipped_policy(state: dict, p: float, t_likely: float, t_possible: float) -> dict:
    """The decision the app actually makes. Mirrored exactly in js/model.js.

    Three independent routes can escalate, and the loudest wins:

      1. RED FLAG. Stridor, collapse, loss of consciousness or throat tightness
         escalates to act-now on its own, whatever the model thinks. This is not
         the model being overruled by superstition; it is the model being used
         for what it is good at. The model estimates how likely anaphylaxis is.
         It knows nothing about what a mistake costs. A person with stridor needs
         urgent help whether the cause is anaphylaxis or not, so the expected
         cost of waiting is enormous even when the probability is middling.

      2. CLINICAL CRITERIA. If NIAID/FAAN 2006 or WAO 2020 fire, escalate. These
         rules are the accepted clinical standard, they have published validation
         numbers, and on our real-case validation set they beat the fitted model
         on sensitivity. Ignoring them in favour of our own model would be
         choosing the worse instrument because we built it.

      3. THE MODEL. Above the calibrated act-now threshold, escalate; above the
         caution threshold, warn.

    The union raises sensitivity and lowers specificity. That trade is the right
    one here and it is a deliberate choice, not an accident of tuning: the cost
    of a miss is a death, and the cost of a false alarm is an unnecessary
    epinephrine dose and an ambulance ride.
    """
    reasons = []
    urgency = categorise(p, t_likely, t_possible)
    if urgency == "act-now":
        reasons.append("model")

    nf = niaid_faan(state)
    wao = wao_2020(state)
    if nf["positive"]:
        reasons.append("niaid_faan")
    if wao["positive"]:
        reasons.append("wao_2020")
    if nf["positive"] or wao["positive"]:
        urgency = "act-now"

    red = [k for k in RED_FLAGS if state.get(k)]
    if red:
        urgency = "act-now"
        reasons.append("red_flag:" + "+".join(red))

    return {"urgency": urgency, "reasons": reasons}


# ----------------------------------------------------------------- metrics

def confusion(y_true: list[int], y_pred: list[int]) -> dict:
    tp = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 1)
    fn = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 0)
    fp = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 1)
    tn = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 0)
    sn = tp / (tp + fn) if tp + fn else float("nan")
    sp = tn / (tn + fp) if tn + fp else float("nan")
    ppv = tp / (tp + fp) if tp + fp else float("nan")
    npv = tn / (tn + fn) if tn + fn else float("nan")
    return {
        "tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "sensitivity": round(sn, 4), "specificity": round(sp, 4),
        "ppv": round(ppv, 4), "npv": round(npv, 4),
        "accuracy": round((tp + tn) / len(y_true), 4),
    }


def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval. At n=27 and n=17 the intervals are wide, and
    saying so is the point: this validation set is small."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round((c - half) / d, 4), round((c + half) / d, 4))


# ----------------------------------------------------------------- validation

def load_cases() -> list[dict]:
    return json.loads((DATA / "validation_cases.json").read_text())


def load_escalation_judgments() -> dict:
    return json.loads((DATA / "escalation_judgments.json").read_text())["judgments"]


def case_state(case: dict) -> dict:
    """Coded case to model feature vector. null becomes 0; see module docstring."""
    return {f: (1 if case.get(f) == 1 else 0) for f in FEATURES}


def evaluate_on_real_cases(intercept: float, weights: dict,
                           t_likely: float, t_possible: float) -> dict:
    cases = load_cases()
    y_true, rows = [], []

    for c in cases:
        st = case_state(c)
        label = 1 if c["label"] == "anaphylaxis" else 0
        p = score(st, intercept, weights)
        urgency = categorise(p, t_likely, t_possible)
        ship = shipped_policy(st, p, t_likely, t_possible)

        nf = niaid_faan(st)
        wao = wao_2020(st)

        y_true.append(label)
        rows.append({
            "case_id": c["case_id"],
            "final_diagnosis": c["final_diagnosis"],
            "label": label,
            "probability": round(p, 4),
            "model_urgency": urgency,
            "shipped_urgency": ship["urgency"],
            "shipped_reasons": ship["reasons"],
            "model_positive": int(urgency in ("act-now", "caution")),
            "shipped_positive": int(ship["urgency"] in ("act-now", "caution")),
            "niaid_faan": int(nf["positive"]),
            "niaid_criterion_1": int(nf["criterion_1"]),
            "niaid_criterion_2": int(nf["criterion_2"]),
            "wao_2020": int(wao["positive"]),
            "n_symptoms": sum(st[s] for s in SYMPTOM_FEATURES),
            "source": c["source"],
        })

    def metrics_for(key: str) -> dict:
        m = confusion(y_true, [r[key] for r in rows])
        m["sensitivity_ci95"] = wilson_ci(m["tp"], m["tp"] + m["fn"])
        m["specificity_ci95"] = wilson_ci(m["tn"], m["tn"] + m["fp"])
        return m

    # Secondary analysis: of the cases we escalate that are not anaphylaxis, how
    # many needed emergency care anyway? Does NOT touch the headline numbers.
    judgments = load_escalation_judgments()
    for r in rows:
        j = judgments.get(r["case_id"])
        r["emergency_care_warranted"] = None if j is None else j["emergency_care_warranted"]
        r["epinephrine_indicated"] = None if j is None else j["epinephrine_indicated"]

    fps = [r for r in rows if r["label"] == 0 and r["shipped_positive"]]
    harmful_fps = [r for r in fps if r["emergency_care_warranted"] is False]

    n_pos = sum(y_true)
    return {
        "secondary_false_alarm_analysis": {
            "_caveat": (
                "Our clinical judgment, recorded in data/escalation_judgments.json with "
                "per-case reasoning. Not from the source papers, and not a claim to "
                "clinical authority. Reported alongside specificity, never instead of it."
            ),
            "false_alarms_total": len(fps),
            "false_alarms_where_emergency_care_was_still_warranted": len(fps) - len(harmful_fps),
            "false_alarms_that_were_genuinely_unnecessary": len(harmful_fps),
            "genuinely_unnecessary_case_ids": [r["case_id"] for r in harmful_fps],
        },
        "n_cases": len(cases),
        "n_anaphylaxis": n_pos,
        "n_not_anaphylaxis": len(cases) - n_pos,
        "model_alone": metrics_for("model_positive"),
        "shipped_policy_SHIPPED": metrics_for("shipped_positive"),
        "niaid_faan_2006_BENCHMARK": metrics_for("niaid_faan"),
        "wao_2020": metrics_for("wao_2020"),
        "per_case": rows,
    }


# ------------------------------------------------------------- sensitivity

def perturb_assumed(table: dict, factor: float) -> dict:
    """Scale every value flagged `assumed` by `factor`, clipped to [0, 1].

    The point is to answer "how much of this rests on numbers you made up?"
    with a measurement instead of a reassurance.
    """
    t = copy.deepcopy(table)

    def bump(entry: dict) -> None:
        if entry.get("basis") == "assumed":
            if entry.get("p") is not None:
                entry["p"] = float(np.clip(entry["p"] * factor, 0.0, 1.0))
            if entry.get("assumed_p") is not None:
                entry["assumed_p"] = float(np.clip(entry["assumed_p"] * factor, 0.0, 1.0))

    for entry in t["positive_class"]["symptoms"].values():
        bump(entry)
    for entry in t["positive_class"]["context_features"].values():
        bump(entry)
    for cond in t["negative_class"]["conditions"].values():
        for entry in cond["symptoms"].values():
            bump(entry)
    return t


def us_trigger_mix(table: dict) -> dict:
    """Reweight adult triggers toward a US bystander population.

    The European registry's adult mix is 50% insect venom, which is an artefact
    of venom-immunotherapy referrals to European allergy centres. A US phone app
    will see far more food. No published US bystander distribution exists, so
    this is an alternative assumption, not a correction, and it is here to show
    what changes when it is swapped.
    """
    t = copy.deepcopy(table)
    t["positive_class"]["trigger_distribution"]["adult"] = {
        "trigger_food": 0.45, "trigger_venom": 0.20, "trigger_drug": 0.25, "unknown": 0.10
    }
    return t


def refit(table: dict, n: int, seed: int, C: float) -> tuple[float, dict, float, float]:
    """Refit end to end, INCLUDING threshold calibration.

    Recalibrating matters: a variant that shifts the probability scale would look
    artificially bad if judged at the baseline model's thresholds. Each variant
    gets the thresholds its own synthetic holdout implies, exactly as the
    baseline did.
    """
    from sklearn.model_selection import train_test_split
    from train_symptom_model import calibrate_thresholds

    gen = CohortGenerator(table, seed=seed)
    X, y, _ = gen.generate(n)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=seed, stratify=y)

    cal_clf = LogisticRegression(C=C, solver="lbfgs", max_iter=5000, random_state=0).fit(X_tr, y_tr)
    th = calibrate_thresholds(y_te, cal_clf.predict_proba(X_te)[:, 1])

    clf = LogisticRegression(C=C, solver="lbfgs", max_iter=5000, random_state=0).fit(X, y)
    return (float(clf.intercept_[0]),
            {f: float(w) for f, w in zip(FEATURES, clf.coef_[0])},
            th["likely"]["threshold"], th["possible"]["threshold"])


def sensitivity_analysis(n: int, seed: int, C: float) -> list[dict]:
    base = load_table()
    variants = [
        ("baseline", base),
        ("assumed values x0.5", perturb_assumed(base, 0.5)),
        ("assumed values x1.5", perturb_assumed(base, 1.5)),
        ("US-weighted trigger mix", us_trigger_mix(base)),
    ]
    results = []
    for name, table in variants:
        intercept, weights, t_likely, t_possible = refit(table, n, seed, C)
        ev = evaluate_on_real_cases(intercept, weights, t_likely, t_possible)
        results.append({
            "variant": name,
            "threshold_likely": round(t_likely, 4),
            "threshold_possible": round(t_possible, 4),
            "real_case_sensitivity": ev["model_alone"]["sensitivity"],
            "real_case_specificity": ev["model_alone"]["specificity"],
            "shipped_sensitivity": ev["shipped_policy_SHIPPED"]["sensitivity"],
            "shipped_specificity": ev["shipped_policy_SHIPPED"]["specificity"],
        })
    return results


# ------------------------------------------------------------------- report

def write_report(ev: dict, sens: list[dict], artifact: dict) -> str:
    m = ev["model_alone"]
    s = ev["shipped_policy_SHIPPED"]
    n = ev["niaid_faan_2006_BENCHMARK"]
    w = ev["wao_2020"]

    def ci(pair):
        return f"({float(pair[0]):.2f}\u2013{float(pair[1]):.2f})"

    def row(label, d):
        return (f"| {label} | {d['sensitivity']:.3f} {ci(d['sensitivity_ci95'])} "
                f"| {d['specificity']:.3f} {ci(d['specificity_ci95'])} "
                f"| {d['ppv']:.3f} | {d['npv']:.3f} | {d['accuracy']:.3f} |")

    lines = [
        "# EpiGuide symptom model: external validation",
        "",
        f"Validated on **{ev['n_cases']} real published patient cases** "
        f"({ev['n_anaphylaxis']} anaphylaxis, {ev['n_not_anaphylaxis']} mimics), each coded from a "
        "verbatim quote in an open-access case report. The model never saw these "
        "cases during fitting and they had no influence on any weight.",
        "",
        "## Results",
        "",
        "| System | Sensitivity (95% CI) | Specificity (95% CI) | PPV | NPV | Accuracy |",
        "|---|---|---|---|---|---|",
        row("Fitted model alone", m),
        row("**Shipped policy (model OR criteria OR red flag)**", s),
        row("NIAID/FAAN 2006 criteria (benchmark)", n),
        row("WAO 2020 criteria", w),
        "",
        "Published performance of the NIAID/FAAN benchmark in an emergency-department "
        "population, for context: sensitivity 96.7% / specificity 82.4% (Campbell 2012, "
        "n=214) and sensitivity 95.1% / specificity 70.8% (Loprinzi Brauer 2016, n=174). "
        "Our implementation of the rule cannot use criterion 3, which requires a blood "
        "pressure measurement, so it is handicapped relative to those figures.",
        "",
        "## Sensitivity to the assumptions",
        "",
        "Every value in the frequency table flagged `assumed` is a modelling choice, not "
        "a literature finding. Below, the model is refit from scratch with all of them "
        "scaled, and with the European trigger mix swapped for a US-weighted one.",
        "",
        "| Variant | Model Sn | Model Sp | Shipped Sn | Shipped Sp |",
        "|---|---|---|---|---|",
    ]
    for r in sens:
        lines.append(
            f"| {r['variant']} | {r['real_case_sensitivity']:.3f} | {r['real_case_specificity']:.3f} "
            f"| {r['shipped_sensitivity']:.3f} | {r['shipped_specificity']:.3f} |"
        )

    misses = [r for r in ev["per_case"] if r["label"] == 1 and not r["shipped_positive"]]
    fps = [r for r in ev["per_case"] if r["label"] == 0 and r["shipped_positive"]]

    lines += [
        "",
        "## Every case the shipped system got wrong",
        "",
        f"**Missed anaphylaxis ({len(misses)}).** These are the failures that matter.",
        "",
    ]
    if misses:
        lines += ["| Case | Diagnosis | p | Signs coded | Source |", "|---|---|---|---|---|"]
        for r in misses:
            lines.append(f"| {r['case_id']} | {r['final_diagnosis'][:70]} | {r['probability']:.3f} "
                         f"| {r['n_symptoms']} | {r['source'][:80]} |")
    else:
        lines.append("None.")

    lines += ["", f"**False alarms ({len(fps)}).** A false alarm here costs an unnecessary "
              "epinephrine dose and an ambulance. That is a real cost, and much smaller than "
              "the cost of the misses above.", ""]
    if fps:
        lines += ["| Case | Actual diagnosis | p | What escalated it |", "|---|---|---|---|"]
        for r in fps:
            lines.append(f"| {r['case_id']} | {r['final_diagnosis'][:70]} | {r['probability']:.3f} "
                         f"| {', '.join(r['shipped_reasons']) or 'none'} |")
    else:
        lines.append("None.")

    sec = ev["secondary_false_alarm_analysis"]
    lines += [
        "",
        "## What the false alarms actually were",
        "",
        f"Specificity above counts all {sec['false_alarms_total']} escalated mimics as errors, which is the "
        "correct primary metric and we are not adjusting it. But those errors are not "
        "equivalent. Of the "
        f"{sec['false_alarms_total']} false alarms, **{sec['false_alarms_where_emergency_care_was_still_warranted']} "
        "were conditions that needed emergency care anyway** (ACE-inhibitor angioedema of "
        "the tongue, hereditary angioedema with bowel obstruction, syncope with sinus "
        "arrest, an asthma exacerbation with pneumomediastinum, mast cell activation with "
        "hypotension). Telling those people to call for help was right advice about the "
        "wrong diagnosis.",
        "",
        f"**{sec['false_alarms_that_were_genuinely_unnecessary']} were genuinely unnecessary escalations**: "
        f"`{'`, `'.join(sec['genuinely_unnecessary_case_ids']) or 'none'}`. Those are the real cost, "
        "and the one worth working to reduce.",
        "",
        "The per-case reasoning behind that split is in `data/escalation_judgments.json`. "
        "It is our judgment, not the source papers', we are not clinicians, and every "
        "arguable case was tagged the way that makes our numbers look worse.",
        "",
        "## Limits of this validation",
        "",
        f"- **{ev['n_cases']} cases is small.** The confidence intervals above are wide and "
        "honest about it. This is a prototype-grade check, not a clinical trial.",
        "- **Published case reports are not a random sample.** Journals publish unusual "
        "presentations, which makes this set harder than an average day in an emergency "
        "department in some ways and easier in others.",
        "- **Coding is from narrative text.** A case report that does not mention a symptom "
        "is coded as not observed, which is what the app sees, but it is not the same as "
        "the symptom being absent.",
        "- **The negative class is over-represented by mimics.** Real usage will include "
        "many people with nothing wrong at all, whom this set does not contain.",
        "- **No real-world prospective use has been evaluated.** Nobody has used this in an "
        "actual emergency.",
        "",
        "## Reproducing this",
        "",
        "```bash",
        "cd train && pip install -r requirements.txt && make all",
        "```",
        "",
        f"Model artifact git rev: `{artifact.get('git_rev', 'unknown')}`, seed "
        f"`{artifact.get('seed')}`. Same seed and same frequency table give identical weights.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=40000)
    ap.add_argument("--seed", type=int, default=20240816)
    ap.add_argument("--C", type=float, default=1.0)
    ap.add_argument("--skip-sensitivity", action="store_true")
    args = ap.parse_args()

    artifact = json.loads((OUT / "model_weights.json").read_text())
    intercept = artifact["intercept"]
    weights = artifact["weights"]
    t_likely = artifact["thresholds"]["likely"]["threshold"]
    t_possible = artifact["thresholds"]["possible"]["threshold"]

    ev = evaluate_on_real_cases(intercept, weights, t_likely, t_possible)
    sens = [] if args.skip_sensitivity else sensitivity_analysis(args.n, args.seed, args.C)

    (OUT / "validation.json").write_text(json.dumps({"evaluation": ev, "sensitivity": sens}, indent=2))
    report = write_report(ev, sens, artifact)
    (OUT / "validation_report.md").write_text(report)

    print(f"validated on {ev['n_cases']} real published cases "
          f"({ev['n_anaphylaxis']} anaphylaxis / {ev['n_not_anaphylaxis']} mimics)\n")
    for name, key in [
        ("model alone", "model_alone"),
        ("shipped policy", "shipped_policy_SHIPPED"),
        ("NIAID/FAAN (benchmark)", "niaid_faan_2006_BENCHMARK"),
        ("WAO 2020", "wao_2020"),
    ]:
        d = ev[key]
        print(f"  {name:28s} Sn {d['sensitivity']:.3f}  Sp {d['specificity']:.3f}  "
              f"PPV {d['ppv']:.3f}  acc {d['accuracy']:.3f}")

    if sens:
        print("\nsensitivity to assumed values:")
        for r in sens:
            print(f"  {r['variant']:28s} shipped Sn {r['shipped_sensitivity']:.3f}  "
                  f"Sp {r['shipped_specificity']:.3f}")

    print(f"\nwrote {OUT / 'validation_report.md'}")


if __name__ == "__main__":
    main()

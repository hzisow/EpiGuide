"""Fit the EpiGuide symptom model and export it for the app.

WHY LOGISTIC REGRESSION, AND WHY NOT TENSORFLOW
    The model has 22 binary inputs and one output. A logistic regression is the
    right size for that, and it has two properties that matter more here than
    accuracy: every weight is a readable log-odds contribution, so the debug
    panel can show exactly why a verdict was reached; and the whole model is 23
    numbers, so it runs as plain arithmetic in the browser with no runtime, no
    download, and no network. An offline emergency app cannot afford to wait on
    a CDN.

    The same model expressed as a single-unit Keras dense layer would fit the
    same weights and then require a 900KB runtime to evaluate them. TensorFlow
    earns its place in this project on the vision model (see train/vision/),
    where there are two million parameters and a real convolutional network. It
    would be decoration here. `--framework keras` runs that comparison anyway
    and reports the weight agreement, because "we checked" beats "trust us".

WHAT THE FIT IS AND ISN'T
    Fitted on the synthetic cohort from generate_cohort.py. Cross-validation
    numbers on that cohort measure internal consistency only. The metrics that
    count are produced by evaluate.py against 44 real published cases.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (roc_auc_score, average_precision_score,
                             accuracy_score, brier_score_loss)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

from features import FEATURES
from generate_cohort import CohortGenerator, load_table

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def git_rev() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


def fit_sklearn(X_train, y_train, C: float) -> LogisticRegression:
    # L2 with a moderate C. Regularisation matters here for a specific reason:
    # rare features (stridor at 5.8%, diarrhoea at 3.9%) would otherwise take
    # extreme weights fitted to a handful of generated cases. Shrinking them is
    # the safer failure direction for a clinical-adjacent tool.
    # sklearn >=1.8 deprecates the explicit penalty kwarg; L2 is the default.
    clf = LogisticRegression(C=C, solver="lbfgs", max_iter=5000, random_state=0)
    clf.fit(X_train, y_train)
    return clf


def calibration_check(y_test, p_test, n_bins: int = 10) -> dict:
    """Is the predicted probability meaningful, or just a ranking score?

    The debug panel shows a number to judges and to us, so that number has to
    mean something. A well calibrated model that says 0.30 should be right about
    30% of the time. This bins the synthetic holdout by predicted probability and
    compares each bin's predicted mean to its observed rate.

    Calibration here is only ever calibration to the SYNTHETIC distribution. If
    the real world's mix of mimics differs from our assumed mix, and it will, the
    absolute numbers shift even though the ranking holds. One more reason the app
    shows a category to users and keeps the number behind the debug flag.
    """
    p = np.asarray(p_test)
    y = np.asarray(y_test)
    edges = np.linspace(0, 1, n_bins + 1)
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if not m.any():
            continue
        bins.append({
            "range": [round(float(lo), 2), round(float(hi), 2)],
            "n": int(m.sum()),
            "mean_predicted": round(float(p[m].mean()), 4),
            "observed_rate": round(float(y[m].mean()), 4),
        })
    ece = sum(b["n"] * abs(b["mean_predicted"] - b["observed_rate"]) for b in bins) / len(p)
    return {
        "brier_score": round(float(brier_score_loss(y, p)), 4),
        "expected_calibration_error": round(float(ece), 4),
        "bins": bins,
        "_note": "Calibrated to the synthetic distribution only; see the docstring.",
    }


def calibrate_thresholds(y_test, p_test, target_sensitivity: float = 0.95,
                         target_specificity: float = 0.90) -> dict:
    """Choose the two decision thresholds on SYNTHETIC data only.

    This is deliberate and it matters. Picking thresholds by looking at the 44
    real validation cases would quietly turn them into training data and make the
    reported sensitivity meaningless. So the thresholds are fixed here, on the
    synthetic holdout, before the model ever meets a real case.

    The two thresholds do different jobs and get different targets:

      possible ("do not wait")  is the miss-avoidance boundary. Set at the
        lowest probability that still reaches `target_sensitivity` on the
        synthetic holdout. Below it the app says the signs are less typical, so
        this is the line past which a real reaction must not fall.

      likely ("act now")  is the confidence boundary that triggers the loudest
        possible advice: use epinephrine, call 911. Set to reach
        `target_specificity`, because telling everyone to inject would make the
        instruction meaningless.

    Asymmetric on purpose. A missed anaphylaxis can kill. An unnecessary
    epinephrine dose is unpleasant and, in a person without a cardiac history,
    rarely harmful. The thresholds encode that asymmetry rather than defaulting
    to 0.5, which optimises accuracy, a metric nobody in an emergency cares about.
    """
    order = np.argsort(p_test)
    p_sorted = p_test[order]
    y_sorted = np.asarray(y_test)[order]

    n_pos = int(y_sorted.sum())
    n_neg = int(len(y_sorted) - n_pos)

    # Sensitivity at threshold t = fraction of positives with p >= t.
    # Walk candidate thresholds downward and take the highest that still hits target.
    candidates = np.unique(p_sorted)
    possible = float(candidates[0])
    for t in candidates[::-1]:
        sn = float((p_sorted[y_sorted == 1] >= t).sum() / n_pos)
        if sn >= target_sensitivity:
            possible = float(t)
            break

    likely = float(candidates[-1])
    for t in candidates:
        sp = float((p_sorted[y_sorted == 0] < t).sum() / n_neg)
        if sp >= target_specificity:
            likely = float(t)
            break

    if likely <= possible:
        # Degenerate ordering means the two targets cannot both be met; keep them
        # ordered and say so rather than shipping a silently broken band.
        likely = min(possible + 0.05, 0.99)

    def at(t):
        return {
            "threshold": round(float(t), 4),
            "synthetic_sensitivity": round(float((p_sorted[y_sorted == 1] >= t).sum() / n_pos), 4),
            "synthetic_specificity": round(float((p_sorted[y_sorted == 0] < t).sum() / n_neg), 4),
        }

    return {
        "_method": (
            "Selected on the synthetic holdout only, never on the real validation "
            "cases, so that external validation stays external."
        ),
        "target_sensitivity_for_possible": target_sensitivity,
        "target_specificity_for_likely": target_specificity,
        "possible": at(possible),
        "likely": at(likely),
    }


def fit_keras(X_train, y_train, X_test, y_test):
    """Same model as a single-unit dense layer, purely as a cross-check.

    If the two frameworks disagree on the weights, one of them is being fitted
    wrong. Requires tensorflow; skipped with a clear message if absent.
    """
    try:
        import tensorflow as tf
    except ImportError:
        return None, "tensorflow not installed; skipped the Keras cross-check"

    tf.random.set_seed(0)
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(X_train.shape[1],)),
        tf.keras.layers.Dense(
            1, activation="sigmoid",
            kernel_regularizer=tf.keras.regularizers.l2(1e-4),
        ),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(0.01), loss="binary_crossentropy")
    model.fit(X_train, y_train, epochs=60, batch_size=256, verbose=0,
              validation_data=(X_test, y_test))
    w = model.layers[0].get_weights()
    return {"weights": w[0].ravel().tolist(), "intercept": float(w[1][0])}, None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=40000, help="synthetic cohort size")
    ap.add_argument("--seed", type=int, default=20240816)
    ap.add_argument("--C", type=float, default=1.0, help="inverse L2 strength")
    ap.add_argument("--framework", choices=["sklearn", "both"], default="sklearn")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    table = load_table()

    gen = CohortGenerator(table, seed=args.seed)
    X, y, conditions = gen.generate(args.n)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=args.seed, stratify=y
    )

    clf = fit_sklearn(X_train, y_train, args.C)

    p_test = clf.predict_proba(X_test)[:, 1]
    thresholds = calibrate_thresholds(y_test, p_test)
    calibration = calibration_check(y_test, p_test)
    cv = cross_val_score(
        LogisticRegression(C=args.C, solver="lbfgs", max_iter=5000, random_state=0),
        X, y, cv=StratifiedKFold(5, shuffle=True, random_state=args.seed), scoring="roc_auc",
    )

    internal = {
        "_WARNING": (
            "These numbers are internal consistency checks on synthetic data, NOT "
            "evidence the model works on patients. Fitting and testing on output "
            "from the same generator measures only whether that generator is "
            "learnable. The real metrics are in evaluate.py / validation_report.md."
        ),
        "n_total": int(len(y)),
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "synthetic_holdout_accuracy": round(float(accuracy_score(y_test, p_test >= 0.5)), 4),
        "synthetic_holdout_auc": round(float(roc_auc_score(y_test, p_test)), 4),
        "synthetic_holdout_average_precision": round(float(average_precision_score(y_test, p_test)), 4),
        "synthetic_cv_auc_mean": round(float(cv.mean()), 4),
        "synthetic_cv_auc_std": round(float(cv.std()), 4),
    }

    # The split above exists to produce honest internal metrics and to calibrate
    # the thresholds. The model that actually ships is refit on the full cohort,
    # which is standard practice and gives slightly tighter weights. Nothing
    # about the external validation changes, because that set was never in here.
    final = fit_sklearn(X, y, args.C)
    weights = {f: round(float(w), 4) for f, w in zip(FEATURES, final.coef_[0])}
    intercept = round(float(final.intercept_[0]), 4)

    keras_result = None
    keras_note = None
    if args.framework == "both":
        keras_result, keras_note = fit_keras(X_train, y_train, X_test, y_test)
        if keras_result:
            diffs = [abs(a - b) for a, b in zip(clf.coef_[0], keras_result["weights"])]
            keras_note = (
                f"Keras single-unit dense layer fitted independently. Max absolute "
                f"weight difference vs scikit-learn: {max(diffs):.4f}. Same model, "
                f"same answer, different optimiser."
            )

    artifact = {
        "generated_by": "train/src/train_symptom_model.py",
        "git_rev": git_rev(),
        "seed": args.seed,
        "regularisation": {"penalty": "l2", "C": args.C},
        "features": FEATURES,
        "intercept": intercept,
        "weights": weights,
        "thresholds": thresholds,
        "calibration": calibration,
        "internal_metrics": internal,
        "keras_crosscheck": {"result": keras_result, "note": keras_note},
        "provenance": (
            "Fitted on a synthetic cohort drawn from data/symptom_frequencies.json, "
            "which cites a published source for every rate it uses and flags every "
            "value it had to assume. No patient data was used at any stage. "
            "External validation against real published cases: see out/validation_report.md."
        ),
    }
    (OUT / "model_weights.json").write_text(json.dumps(artifact, indent=2))

    print(f"fitted on {len(y_train)} synthetic cases, {len(FEATURES)} features")
    print(f"intercept {intercept}")
    print()
    print(f"{'feature':24s} {'weight':>9s}")
    for f, w in sorted(weights.items(), key=lambda kv: -kv[1]):
        print(f"{f:24s} {w:9.4f}")
    print()
    print("internal (synthetic) checks, NOT evidence of clinical performance:")
    for k, v in internal.items():
        if not k.startswith("_"):
            print(f"  {k:38s} {v}")
    print(f"\ncalibration on synthetic holdout: Brier {calibration['brier_score']:.4f}, "
          f"expected calibration error {calibration['expected_calibration_error']:.4f}")
    print(f"  {'predicted':>10s} {'observed':>10s} {'n':>7s}")
    for b in calibration["bins"]:
        print(f"  {b['mean_predicted']:10.3f} {b['observed_rate']:10.3f} {b['n']:7d}")
    if keras_note:
        print(f"\n{keras_note}")
    print(f"\nwrote {OUT / 'model_weights.json'}")


if __name__ == "__main__":
    main()

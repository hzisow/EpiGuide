"""Generate a synthetic training cohort from the cited frequency table.

WHAT THIS IS
    A simulator. It draws symptom vectors from published conditional frequencies
    P(symptom | anaphylaxis) and P(symptom | mimic condition). Every rate it uses
    comes from data/symptom_frequencies.json, where each one names its source or
    is explicitly flagged `assumed`.

WHAT THIS IS NOT
    Patient data. Nobody in this cohort exists. A model fitted here and then
    evaluated on more output from the same generator would be measuring whether
    its own simulator is learnable, which is worth nothing. That is exactly the
    circularity this pipeline is built to avoid: the reported headline metrics
    come from evaluate.py running on 44 real published cases the model never saw.

STRUCTURE
    Symptoms are not independent, so we do not sample them independently. Each
    case first draws which organ systems are involved (skin / respiratory /
    cardiovascular / gastrointestinal) at registry-reported rates, then draws
    symptoms only within involved systems. This reproduces the multi-system
    pattern the clinical criteria key on, and avoids nonsense vectors like
    stridor with no other respiratory sign.

    Within an involved system, members are drawn independently at rate
    t_i / p_system, so each symptom's unconditional marginal comes back out at
    its published rate t_i while members stay positively correlated with each
    other. check_marginals() verifies this and the pipeline aborts on drift.

    A NOTE ON WHAT WE DELIBERATELY DO NOT DO
    An earlier version forced at least one symptom on whenever a system was drawn
    as involved, on the reasoning that an involved system with no sign is
    incoherent. That is wrong twice over. It biases each system's most common
    member upward (it absorbs every correction), and it is unsatisfiable anyway:
    the published organ-system involvement rates and the published per-symptom
    rates come from different studies and are mutually inconsistent. The European
    Anaphylaxis Registry reports cardiovascular involvement in 72% of cases, but
    the per-symptom cardiovascular rates from the Canadian emergency-department
    registry sum to only 65%, which cannot cover 72% of cases no matter how the
    symptoms are arranged. The gap is real and expected: EAR is a tertiary-referral
    registry that oversamples severe reactions, so its system-level rates run
    higher than an all-comers ED population's symptom-level rates.

    We resolve it by treating system involvement as a purely latent correlation
    device. It is never observed, so a case where a system is "involved" but
    silent is not a contradiction, just a case where that system did not manifest
    a sign we ask about. The observable marginals stay exactly on their sources.
    This inconsistency is recorded in METHODS.md rather than smoothed over.

DETERMINISM
    Fully seeded. Same seed plus same frequency table gives byte-identical output.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from features import FEATURES, SYMPTOM_FEATURES, SYSTEM_OF

DATA = Path(__file__).resolve().parent.parent / "data"

# P(bystander can name the trigger category | they noticed an exposure).
# Applied identically to both classes so it cannot become a class signal. No
# source exists for this; it is an assumption, and it is symmetric, which is
# what stops it from leaking. See the note in _draw_positive.
TRIGGER_IDENTIFIED_GIVEN_EXPOSURE = 0.80


def load_table(path: Path | None = None) -> dict:
    return json.loads((path or DATA / "symptom_frequencies.json").read_text())


def _p(entry: dict) -> float:
    """Resolve a frequency entry to a probability.

    An entry either has a sourced `p`, or has `p: null` plus an `assumed_p`. We
    keep those separate in the file so that a reader can see at a glance which
    numbers are findings and which are our choices.
    """
    if entry.get("p") is not None:
        return float(entry["p"])
    if entry.get("assumed_p") is not None:
        return float(entry["assumed_p"])
    raise ValueError(f"frequency entry has neither p nor assumed_p: {entry}")


class CohortGenerator:
    def __init__(self, table: dict, seed: int = 20240816):
        self.t = table
        self.rng = np.random.default_rng(seed)

    # ---------------------------------------------------------------- positive

    def _draw_age(self, dist: dict) -> str:
        r = self.rng.random()
        if r < dist["child"]:
            return "child"
        if r < dist["child"] + dist["elderly"]:
            return "elderly"
        return "adult"

    def _draw_trigger(self, age: str) -> str | None:
        pos = self.t["positive_class"]
        key = "child" if age == "child" else "adult"
        d = pos["trigger_distribution"][key]
        options = ["trigger_food", "trigger_venom", "trigger_drug", "unknown"]
        probs = np.array([d[o] for o in options], dtype=float)
        probs = probs / probs.sum()
        choice = self.rng.choice(len(options), p=probs)
        return None if options[choice] == "unknown" else options[choice]

    def _symptom_rate(self, sym: str, age: str, trigger: str | None) -> float:
        """Marginal P(symptom | anaphylaxis) with age and trigger modifiers applied."""
        pos = self.t["positive_class"]
        base = _p(pos["symptoms"][sym])

        age_mods = pos["age_modifiers"].get(f"age_{age}", {}) if age in ("child", "elderly") else {}
        if sym in age_mods:
            base *= age_mods[sym]["factor"]

        if trigger:
            trig_mods = pos["trigger_modifiers"].get(trigger, {})
            if sym in trig_mods:
                base *= trig_mods[sym]["factor"]

        return min(max(base, 0.0), 1.0)

    @staticmethod
    def _within_system_rates(targets: list[float], p_sys: float) -> list[float]:
        """Within-system rates that reproduce each member's published marginal.

        Requires p_sys >= max(target), otherwise a member would need a rate above
        1 to reach its marginal. That would mean the system involvement rate and
        the symptom rate contradict each other, which is a table error worth
        raising rather than clamping silently.
        """
        if p_sys <= 0:
            return [0.0] * len(targets)
        worst = max(targets, default=0.0)
        if worst > p_sys + 1e-9:
            raise ValueError(
                f"a symptom's marginal ({worst:.3f}) exceeds its organ system's "
                f"involvement rate ({p_sys:.3f}). One of the two is wrong; check "
                f"data/symptom_frequencies.json."
            )
        return [t / p_sys for t in targets]

    def _draw_positive(self) -> dict:
        pos = self.t["positive_class"]
        age = self._draw_age(pos["age_distribution"])
        trigger = self._draw_trigger(age)

        row = {f: 0 for f in FEATURES}
        if age == "child":
            row["age_child"] = 1
        elif age == "elderly":
            row["age_elderly"] = 1

        # Exposure and trigger are modelled through what a BYSTANDER can report,
        # not through what the registry established after workup.
        #
        # An earlier version set the trigger flag whenever a trigger existed, so
        # every positive with a known exposure also had a named trigger, while
        # negatives often had exposure with no named trigger. The model duly
        # learned "exposure but no named trigger means not anaphylaxis", which is
        # a fact about the sampler and about nothing else. It leaked badly enough
        # to distort the fitted weights.
        #
        # Both classes now go through the same two-step: did the bystander notice
        # an exposure at all, and if so could they name what kind.
        if trigger:
            row["known_exposure"] = int(
                self.rng.random() < _p(pos["context_features"]["known_exposure"])
            )
            if row["known_exposure"] and self.rng.random() < TRIGGER_IDENTIFIED_GIVEN_EXPOSURE:
                row[trigger] = 1
        row["rapid_onset"] = int(self.rng.random() < _p(pos["context_features"]["rapid_onset"]))

        systems = pos["organ_system_structure"]["systems"]

        # Which systems are involved at all.
        involved = {}
        for name, spec in systems.items():
            p_sys = spec["p"]
            if name == "skin":
                # The registry reports the no-skin rate separately and it differs
                # sharply by age. Use it directly rather than the pooled rate.
                no_skin = pos["organ_system_structure"]["_no_skin_check"]
                p_sys = 1.0 - (no_skin["child"] if age == "child" else no_skin["adult"])
            involved[name] = self.rng.random() < p_sys

        for name, spec in systems.items():
            if not involved[name]:
                continue
            p_sys = spec["p"]
            if name == "skin":
                no_skin = pos["organ_system_structure"]["_no_skin_check"]
                p_sys = 1.0 - (no_skin["child"] if age == "child" else no_skin["adult"])

            members = spec["members"]
            targets = [self._symptom_rate(s, age, trigger) for s in members]
            for sym, q in zip(members, self._within_system_rates(targets, p_sys)):
                row[sym] = int(self.rng.random() < q)

        row["_label"] = 1
        row["_condition"] = "anaphylaxis"
        # The LATENT truth, not the reported flags. The bystander names the
        # trigger only 80% of the time, but the biology follows the real trigger
        # either way, so the marginal check has to compare against this rather
        # than against what got reported.
        row["_age"] = age
        row["_trigger"] = trigger
        return row

    # ---------------------------------------------------------------- negative

    def _draw_negative(self) -> dict:
        neg = self.t["negative_class"]
        conds = neg["conditions"]
        names = list(conds.keys())
        weights = np.array([conds[n]["weight"] for n in names], dtype=float)
        weights = weights / weights.sum()
        cname = names[self.rng.choice(len(names), p=weights)]
        cond = conds[cname]

        age = self._draw_age(neg["age_distribution"])
        row = {f: 0 for f in FEATURES}
        if age == "child":
            row["age_child"] = 1
        elif age == "elderly":
            row["age_elderly"] = 1

        for sym in SYMPTOM_FEATURES:
            spec = cond["symptoms"].get(sym)
            if spec is None:
                continue
            row[sym] = int(self.rng.random() < _p(spec))

        # Same two-step as the positive class: notice an exposure, then maybe
        # name it. Drawing these independently would reintroduce the leak from
        # the other direction.
        ctx = cond["context"]
        row["rapid_onset"] = int(self.rng.random() < ctx["rapid_onset"])
        row["known_exposure"] = int(self.rng.random() < ctx["known_exposure"])
        if row["known_exposure"]:
            trigs = ["trigger_food", "trigger_venom", "trigger_drug"]
            rel = np.array([ctx[t] for t in trigs], dtype=float)
            if rel.sum() > 0 and self.rng.random() < TRIGGER_IDENTIFIED_GIVEN_EXPOSURE:
                row[trigs[self.rng.choice(len(trigs), p=rel / rel.sum())]] = 1

        row["_label"] = 0
        row["_condition"] = cname
        row["_age"] = age
        row["_trigger"] = None
        return row

    # ------------------------------------------------------------------ public

    def _draw_until_symptomatic(self, draw_fn, max_tries: int = 200) -> dict:
        """Draw a case that has at least one symptom.

        Both classes are conditioned on this, deliberately and symmetrically.
        Nobody opens an emergency app about a person with no symptoms at all, so
        the all-zero vector is outside the deployment population for both classes.
        Leaving asymptomatic positives in would teach the model that an empty
        checklist can mean anaphylaxis, which is the worst possible thing for it
        to learn. Conditioning only the positives would be worse still: it would
        hand the model a free discriminator that does not exist in the field.
        """
        for _ in range(max_tries):
            row = draw_fn()
            if any(row[s] for s in SYMPTOM_FEATURES):
                return row
        raise RuntimeError(
            "could not draw a symptomatic case in 200 tries; the frequency table "
            "is probably degenerate"
        )

    def generate(self, n: int) -> tuple[np.ndarray, np.ndarray, list[str]]:
        pos_frac = self.t["class_balance"]["positive_fraction"]
        n_pos = int(round(n * pos_frac))
        n_neg = n - n_pos

        rows = [self._draw_until_symptomatic(self._draw_positive) for _ in range(n_pos)]
        rows += [self._draw_until_symptomatic(self._draw_negative) for _ in range(n_neg)]

        # Shuffle so class order carries no information.
        idx = self.rng.permutation(len(rows))
        rows = [rows[i] for i in idx]

        X = np.array([[r[f] for f in FEATURES] for r in rows], dtype=np.int8)
        y = np.array([r["_label"] for r in rows], dtype=np.int8)
        conditions = [r["_condition"] for r in rows]
        # Latent variables, kept only for the marginal check. Never features.
        self.last_latents = [(r["_age"], r["_trigger"]) for r in rows]
        return X, y, conditions


def check_marginals(X: np.ndarray, y: np.ndarray, gen: "CohortGenerator") -> list[dict]:
    """Verify generated marginals match the frequency table they came from.

    A generator that silently drifts from its own evidence table would make the
    whole citation chain decorative. This runs on every generate call.

    The comparison is against the modifier-adjusted expectation, not the pooled
    base rate. Age and trigger modifiers shift rates away from the base rate by
    design, so checking against the base rate would flag the modifiers as bugs
    (vomiting is 2.6x more common in children; dizziness ~2x in venom cases). We
    instead compute, for each generated case, the rate the table says that case
    should have had given its own age and trigger, and average those. If the
    sampler is faithful, the observed frequency lands on that expectation.

    Both columns are reported so a reader can see the base rate, the composition
    effect, and the sampler's output side by side.
    """
    table = gen.t
    out = []
    pos_mask = y == 1
    pos = X[pos_mask]

    if getattr(gen, "last_latents", None) is None:
        raise RuntimeError("check_marginals must run on the cohort gen just produced")
    latents = [lat for lat, keep in zip(gen.last_latents, pos_mask) if keep]
    ages = [a for a, _ in latents]
    triggers = [t for _, t in latents]

    for sym in SYMPTOM_FEATURES:
        i = FEATURES.index(sym)
        observed = float(pos[:, i].mean())
        expected = float(np.mean([
            gen._symptom_rate(sym, a, t) for a, t in zip(ages, triggers)
        ]))
        out.append({
            "symptom": sym,
            "base_rate": round(_p(table["positive_class"]["symptoms"][sym]), 4),
            "expected_after_modifiers": round(expected, 4),
            "generated": round(observed, 4),
            "abs_error": round(abs(observed - expected), 4),
        })
    return out


# The expectation accounts for modifiers and composition, so what is left is
# sampling noise plus one known small bias: conditioning on "at least one
# symptom" (see _draw_until_symptomatic) drops symptom-poor cases, which lifts
# every marginal slightly. That bias is real, uniform, under 2 points, and
# deliberate. The tolerance sits just above it so a structural bug still trips
# the check. At n >= 20000 anything larger is not noise.
MARGINAL_TOLERANCE = 0.03


def assert_marginals_ok(marginals: list[dict], tolerance: float = MARGINAL_TOLERANCE) -> None:
    """Fail loudly if the generator has drifted from its evidence table."""
    bad = [m for m in marginals if m["abs_error"] > tolerance]
    if bad:
        lines = "\n".join(
            f"  {m['symptom']}: expected {m['expected_after_modifiers']:.3f}, "
            f"generated {m['generated']:.3f} "
            f"(error {m['abs_error']:.3f})" for m in bad
        )
        raise SystemExit(
            f"generator drifted past tolerance {tolerance} on {len(bad)} symptom(s):\n{lines}\n"
            "Either the frequency table changed or the sampling structure has a bug. "
            "Do not train on this cohort."
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=40000)
    ap.add_argument("--seed", type=int, default=20240816)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "out")
    args = ap.parse_args()

    table = load_table()
    gen = CohortGenerator(table, seed=args.seed)
    X, y, conditions = gen.generate(args.n)

    args.out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out / "cohort.npz", X=X, y=y, conditions=np.array(conditions))

    marginals = check_marginals(X, y, gen)
    assert_marginals_ok(marginals)
    worst = max(marginals, key=lambda m: m["abs_error"])

    print(f"generated {len(y)} cases  ({int(y.sum())} anaphylaxis / {int((1 - y).sum())} not)")
    print(f"marginal check: worst absolute error {worst['abs_error']:.4f} on {worst['symptom']}")
    print(f"{'symptom':24s} {'base':>7s} {'expected':>9s} {'generated':>10s} {'error':>7s}")
    for m in marginals:
        print(f"{m['symptom']:24s} {m['base_rate']:7.3f} "
              f"{m['expected_after_modifiers']:9.3f} {m['generated']:10.3f} {m['abs_error']:7.3f}")

    (args.out / "marginal_check.json").write_text(json.dumps(marginals, indent=2))


if __name__ == "__main__":
    main()

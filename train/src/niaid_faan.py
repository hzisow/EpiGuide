"""The NIAID/FAAN 2006 clinical criteria, implemented as code.

This is the baseline the model has to justify itself against. It is the accepted
clinical rule for recognising anaphylaxis, it has published validation numbers in
an emergency-department population, and it is not ours:

    Sampson HA, Munoz-Furlong A, Campbell RL, et al. Second symposium on the
    definition and management of anaphylaxis: summary report. Second NIAID/FAAN
    symposium. J Allergy Clin Immunol 2006;117(2):391-397.

Published performance, both single-centre (Mayo Clinic ED), allergist-adjudicated:
    Campbell 2012        (n=214, retrospective)  Sn 96.7%  Sp 82.4%
    Loprinzi Brauer 2016 (n=174, prospective)    Sn 95.1%  Sp 70.8%

CRITERIA, verbatim from the 2006 paper
--------------------------------------
Anaphylaxis is highly likely when any ONE of the following three criteria is met:

1.  Acute onset of illness (minutes to several hours), with involvement of the
    skin, mucosal tissue, or both (e.g. generalized hives, pruritus or flushing,
    and swollen lips, tongue, or uvula) AND AT LEAST ONE OF:
      a. Respiratory compromise (dyspnea, wheeze-bronchospasm, stridor, reduced
         peak expiratory flow, hypoxemia)
      b. Reduced blood pressure or associated symptoms of end-organ dysfunction
         (hypotonia [collapse], syncope, incontinence)

2.  Two or more of the following that occur rapidly after exposure to a LIKELY
    allergen for that patient (minutes to several hours):
      a. Involvement of the skin-mucosal tissue
      b. Respiratory compromise
      c. Reduced blood pressure or associated symptoms
      d. Persistent gastrointestinal symptoms (crampy abdominal pain, vomiting)

3.  Reduced blood pressure after exposure to a KNOWN allergen for that patient
    (minutes to several hours), by age-specific thresholds.

WHAT WE CAN AND CANNOT IMPLEMENT
--------------------------------
Criterion 3 is blood-pressure-only and needs a cuff. A bystander app has no
cuff, so criterion 3 can never fire from our feature vector and is implemented
as always-false, with that fact recorded on every result. This is a real ceiling
on the rule's sensitivity in our setting, not an oversight, and it means our
measured sensitivity for the rule is a lower bound on its clinical sensitivity.

"Reduced PEF" and "hypoxemia" in 1a/2b are likewise objective measures a
bystander cannot supply; we map respiratory compromise onto the reportable signs
only.

Criterion 2d says "persistent" GI symptoms and the 2006 paper never defines
persistent. WAO 2020 replaced the word with "severe" for exactly this reason. We
treat any GI symptom as satisfying 2d and flag the looseness, which makes our
implementation slightly more sensitive and less specific than a strict reading.
"""

from __future__ import annotations

SKIN_MUCOSAL = ("hives", "lip_face_swelling", "flushing", "itching")

# Respiratory compromise, per the 2006 text: "dyspnea, wheeze-bronchospasm,
# stridor, reduced PEF, and hypoxemia". Peak flow and hypoxaemia need equipment
# a bystander does not have. Throat tightness is included because upper-airway
# involvement is universally read as respiratory compromise, and WAO 2020 makes
# that explicit by naming laryngeal symptoms directly.
#
# COUGH IS DELIBERATELY EXCLUDED. It appears nowhere in the published criteria.
# An earlier version of this file included it, which quietly made our benchmark
# MORE sensitive than the rule it claims to implement, and a benchmark you have
# secretly improved is not a benchmark. Cough is still a model feature; it just
# does not satisfy a criterion.
RESPIRATORY = ("trouble_breathing", "wheezing", "throat_tightness", "stridor")

CARDIOVASCULAR = ("collapse", "loss_of_consciousness", "dizziness")
GASTROINTESTINAL = ("vomiting", "abdominal_pain", "diarrhea")


def _any(state: dict, keys) -> bool:
    return any(bool(state.get(k)) for k in keys)


def niaid_faan(state: dict) -> dict:
    """Apply the criteria to one feature vector.

    Returns which criteria fired and the overall verdict, so a disagreement with
    the model can be traced to a specific criterion rather than argued about.
    """
    skin = _any(state, SKIN_MUCOSAL)
    resp = _any(state, RESPIRATORY)
    cardio = _any(state, CARDIOVASCULAR)
    gi = _any(state, GASTROINTESTINAL)

    rapid = bool(state.get("rapid_onset"))
    exposure = bool(state.get("known_exposure"))

    # Criterion 1: skin/mucosal involvement plus respiratory or cardiovascular.
    # The paper says "acute onset of illness (minutes to several hours)", which
    # describes the presentation rather than requiring a documented exposure, so
    # criterion 1 does not require the exposure flag.
    c1 = skin and (resp or cardio)

    # Criterion 2: two or more systems after exposure to a LIKELY allergen.
    systems = sum([skin, resp, cardio, gi])
    c2 = exposure and rapid and systems >= 2

    # Criterion 3: reduced blood pressure after a KNOWN allergen. Not measurable
    # from a bystander feature vector; see module docstring.
    c3 = False

    return {
        "positive": bool(c1 or c2 or c3),
        "criterion_1": bool(c1),
        "criterion_2": bool(c2),
        "criterion_3": c3,
        "criterion_3_measurable": False,
        "systems_involved": systems,
        "detail": {
            "skin_mucosal": skin,
            "respiratory": resp,
            "cardiovascular": cardio,
            "gastrointestinal": gi,
            "rapid_onset": rapid,
            "known_exposure": exposure,
        },
    }


def wao_2020(state: dict) -> dict:
    """WAO 2020 amended criteria, as a secondary comparator.

    Cardona V, Ansotegui IJ, Ebisawa M, et al. World Allergy Organization
    Anaphylaxis Guidance 2020. World Allergy Organ J 2020;13(10):100472.

    Two criteria instead of three. Criterion 1 adds severe GI symptoms as a
    qualifying second system. Criterion 2 lets acute bronchospasm or laryngeal
    involvement alone qualify after a known or highly probable exposure, even
    with no skin signs at all, which is the clinically important addition: a
    reaction that skips the skin still counts.

    No sensitivity or specificity against an adjudicated reference standard has
    been published for these criteria. They are reported here for comparison
    only, not as a validated benchmark.
    """
    skin = _any(state, SKIN_MUCOSAL)
    resp = _any(state, RESPIRATORY)
    cardio = _any(state, CARDIOVASCULAR)
    gi = _any(state, GASTROINTESTINAL)
    exposure = bool(state.get("known_exposure"))

    c1 = skin and (resp or cardio or gi)

    # Laryngeal involvement per WAO: stridor, vocal changes, odynophagia.
    laryngeal = _any(state, ("stridor", "throat_tightness"))
    bronchospasm = _any(state, ("wheezing",))
    hypotension = _any(state, ("collapse",))
    c2 = exposure and (hypotension or bronchospasm or laryngeal)

    return {
        "positive": bool(c1 or c2),
        "criterion_1": bool(c1),
        "criterion_2": bool(c2),
    }

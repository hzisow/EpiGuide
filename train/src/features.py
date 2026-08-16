"""Feature vocabulary shared by every stage of the pipeline.

The order here is the canonical order. It is what the design matrix columns mean,
what the exported weights are keyed on, and what js/model.js consumes. Do not
reorder without re-running the whole pipeline.
"""

SYMPTOM_FEATURES = [
    # skin
    "hives",
    "lip_face_swelling",
    "flushing",
    "itching",
    # respiratory
    "trouble_breathing",
    "wheezing",
    "throat_tightness",
    "cough",
    "stridor",
    # gastrointestinal
    "vomiting",
    "abdominal_pain",
    "diarrhea",
    # cardiovascular
    "dizziness",
    "collapse",
    "loss_of_consciousness",
]

CONTEXT_FEATURES = [
    "known_exposure",
    "rapid_onset",
    "trigger_food",
    "trigger_venom",
    "trigger_drug",
    "age_child",
    "age_elderly",
]

FEATURES = SYMPTOM_FEATURES + CONTEXT_FEATURES

# Which organ system each symptom belongs to. Used by the generator's latent
# structure and by the NIAID/FAAN criteria implementation.
SYSTEM_OF = {
    "hives": "skin", "lip_face_swelling": "skin", "flushing": "skin", "itching": "skin",
    "trouble_breathing": "respiratory", "wheezing": "respiratory",
    "throat_tightness": "respiratory", "cough": "respiratory", "stridor": "respiratory",
    "vomiting": "gastrointestinal", "abdominal_pain": "gastrointestinal",
    "diarrhea": "gastrointestinal",
    "dizziness": "cardiovascular", "collapse": "cardiovascular",
    "loss_of_consciousness": "cardiovascular",
}

# Features the current app UI can actually set. Anything not in here is carried
# by the model but is always 0 in production, which METHODS.md states plainly.
# Source of truth: js/data/checklistItems.js and js/screens/recognize.js.
UI_REACHABLE = {
    "hives", "flushing", "lip_face_swelling", "itching",
    "trouble_breathing", "wheezing", "throat_tightness", "stridor",
    "dizziness", "collapse", "loss_of_consciousness",
    "vomiting", "abdominal_pain", "diarrhea",
    "known_exposure", "rapid_onset",
    "trigger_food", "trigger_venom", "trigger_drug",
}

NOT_UI_REACHABLE = [f for f in FEATURES if f not in UI_REACHABLE]

HUMAN_LABELS = {
    "hives": "Hives",
    "lip_face_swelling": "Lip/face swelling",
    "flushing": "Flushing",
    "itching": "Itching",
    "trouble_breathing": "Trouble breathing",
    "wheezing": "Wheezing",
    "throat_tightness": "Throat tightness",
    "cough": "Cough",
    "stridor": "Stridor (noisy breathing)",
    "vomiting": "Vomiting",
    "abdominal_pain": "Stomach pain",
    "diarrhea": "Diarrhea",
    "dizziness": "Dizziness",
    "collapse": "Collapse",
    "loss_of_consciousness": "Loss of consciousness",
    "known_exposure": "Known trigger exposure",
    "rapid_onset": "Came on fast (<1hr)",
    "trigger_food": "Trigger: food",
    "trigger_venom": "Trigger: insect sting",
    "trigger_drug": "Trigger: medication",
    "age_child": "Child",
    "age_elderly": "Elderly",
}

// Manual symptom check. Each item maps to one or more feature keys understood by
// the model in js/model.js via `modelKeys`. The result card is
// driven by the model's CATEGORY + urgency — never a raw probability (that lives
// in the hidden ?debug panel). Any model feature with no checkbox here simply
// stays 0, which is fine.

export const checklistCategories = [
  {
    id: 'skin-mouth',
    label: 'Skin / Mouth',
    items: [
      { id: 'hives', label: 'Hives or flushed skin', modelKeys: ['hives', 'flushing'] },
      { id: 'lips', label: 'Swollen lips, tongue, or face', modelKeys: ['lip_face_swelling'] },
      { id: 'itching', label: 'Widespread itching', modelKeys: ['itching'] },
    ],
  },
  {
    id: 'breathing',
    label: 'Breathing',
    items: [
      { id: 'wheeze', label: 'Difficulty breathing or wheezing', modelKeys: ['trouble_breathing', 'wheezing'] },
      { id: 'throat', label: 'Tight throat or hoarse voice', modelKeys: ['throat_tightness'] },
      { id: 'stridor', label: 'Noisy, high-pitched breathing', modelKeys: ['stridor'] },
      { id: 'cough', label: 'Persistent coughing', modelKeys: ['cough'] },
    ],
  },
  {
    id: 'heart',
    label: 'Heart / Circulation',
    items: [
      { id: 'dizzy', label: 'Dizziness or faintness', modelKeys: ['dizziness'] },
      { id: 'collapse', label: 'Sudden collapse', modelKeys: ['collapse'] },
      { id: 'unconscious', label: 'Passed out or unresponsive', modelKeys: ['loss_of_consciousness'] },
    ],
  },
  {
    id: 'stomach',
    label: 'Stomach',
    items: [
      { id: 'vomit', label: 'Vomiting', modelKeys: ['vomiting'] },
      { id: 'cramps', label: 'Stomach cramps or pain', modelKeys: ['abdominal_pain'] },
      { id: 'diarrhea', label: 'Diarrhea', modelKeys: ['diarrhea'] },
    ],
  },
  {
    id: 'context',
    label: 'Trigger & timing',
    items: [
      { id: 'exposure', label: 'Known contact with a trigger', modelKeys: ['known_exposure'] },
      { id: 'rapid', label: 'Came on fast (within 1 hour)', modelKeys: ['rapid_onset'] },
      { id: 'food', label: 'Trigger: food', modelKeys: ['trigger_food'] },
      { id: 'venom', label: 'Trigger: insect sting', modelKeys: ['trigger_venom'] },
      { id: 'drug', label: 'Trigger: medication', modelKeys: ['trigger_drug'] },
    ],
  },
];

// Age bands. These are not checkboxes because they are mutually exclusive, and
// because "adult" has to be a real default rather than an unanswered question:
// both age features are 0 for an adult, which is exactly what the model expects.
//
// Age genuinely moves the verdict. The registry data shows lip and face swelling
// is far less common in older patients (angioedema 33.8% in over-65s vs 62.1% in
// children) while loss of consciousness is much more common (33% vs 20%), so the
// same set of signs means something different depending on who you are looking at.
export const ageBands = [
  { id: 'child', label: 'Child', sub: 'Under 18', modelKeys: ['age_child'] },
  { id: 'adult', label: 'Adult', sub: '18 to 64', modelKeys: [] },
  { id: 'elderly', label: 'Older adult', sub: '65+', modelKeys: ['age_elderly'] },
];

export const DEFAULT_AGE_BAND = 'adult';

// Flatten { itemId -> [modelKeys] } for fast lookup when building model state.
export const ITEM_TO_MODEL_KEYS = Object.fromEntries(
  checklistCategories.flatMap((cat) => cat.items.map((item) => [item.id, item.modelKeys]))
);

// Build a model feature map ({ featureKey: 1 }) from checked items plus the
// selected age band. Every one of the model's 22 features is reachable from
// this screen: 19 through checkboxes, and age_child / age_elderly through the
// age selector. Nothing in the model sits permanently at 0 any more.
export function checklistToModelState(checkedItemIds, ageBandId = DEFAULT_AGE_BAND) {
  const state = {};
  for (const id of checkedItemIds) {
    for (const key of ITEM_TO_MODEL_KEYS[id] || []) state[key] = 1;
  }
  const band = ageBands.find((b) => b.id === ageBandId);
  for (const key of band?.modelKeys || []) state[key] = 1;
  return state;
}

// Apply the age band to a feature map built somewhere else (the camera path).
// Age is a property of the patient, not of how the signs were observed, so it
// applies whether the user came through the checklist or the scan.
export function applyAgeBand(modelState, ageBandId = DEFAULT_AGE_BAND) {
  const band = ageBands.find((b) => b.id === ageBandId);
  for (const key of band?.modelKeys || []) modelState[key] = 1;
  return modelState;
}

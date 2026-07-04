// Manual symptom check. Each item maps to one or more feature keys understood by
// the registry-trained model (js/model.js) via `modelKeys`. The result card is
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

// Flatten { itemId -> [modelKeys] } for fast lookup when building model state.
export const ITEM_TO_MODEL_KEYS = Object.fromEntries(
  checklistCategories.flatMap((cat) => cat.items.map((item) => [item.id, item.modelKeys]))
);

// Build a model feature map ({ featureKey: 1 }) from a set of checked item ids.
export function checklistToModelState(checkedItemIds) {
  const state = {};
  for (const id of checkedItemIds) {
    for (const key of ITEM_TO_MODEL_KEYS[id] || []) state[key] = 1;
  }
  return state;
}

// 4 categories × items for the manual symptom check. Copy is verbatim from the
// build spec (Screen 5). The "match" logic counts CATEGORIES (not items) that
// have at least one checked item — 2+ categories => matches anaphylaxis.

export const checklistCategories = [
  {
    id: 'skin-mouth',
    label: 'Skin / Mouth',
    items: [
      { id: 'hives', label: 'Hives, swelling, or flushed skin', checked: false },
      { id: 'lips', label: 'Swollen lips, tongue, or throat', checked: false },
    ],
  },
  {
    id: 'breathing',
    label: 'Breathing',
    items: [
      { id: 'wheeze', label: 'Difficulty breathing or wheezing', checked: false },
      { id: 'throat', label: 'Tight throat or hoarse voice', checked: false },
    ],
  },
  {
    id: 'heart',
    label: 'Heart / Circulation',
    items: [
      { id: 'dizzy', label: 'Dizziness or fainting', checked: false },
      { id: 'pulse', label: 'Rapid or weak pulse', checked: false },
    ],
  },
  {
    id: 'stomach',
    label: 'Stomach',
    items: [
      { id: 'vomit', label: 'Vomiting or severe stomach cramps', checked: false },
    ],
  },
];

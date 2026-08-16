# train/vision/

The camera model: data, training code, and an audit of the weights currently
shipping in `js/vision-model/`.

The audit is the important part of this directory. It changed the app.

## What we found

We loaded the shipped TensorFlow.js weights and ran them over **359 real SCIN
images** (150 dermatologist-labelled urticaria, 150 other skin conditions, and
all 59 cases dermatologists graded as showing no discernible pathology).

Two claims the code used to make turned out to be wrong, in opposite directions.

### The signal driving the camera verdict was near-constant

`js/screens/recognize.js` decided a skin reaction was present when
`1 - P(normal_skin) >= 0.6`. On real images that expression exceeded 0.6 on
**98.6% of everything tested**, including **54 of the 59** images with no
discernible pathology. Median value was 1.000 in every group.

| true group | n | mean 1 − P(normal) | specificity as a detector |
|---|---|---|---|
| urticaria | 150 | 0.997 | |
| other condition | 150 | 0.998 | |
| no discernible pathology | 59 | 0.916 | **0.085** |

A cue that fires on 98.6% of inputs is not evidence. It was pushing
`hives = 1` into the symptom model on essentially every scan.

### The signal we had written off is the good one

The same file said the hives-vs-other-rash split was "NOT reliable" and hid it
in the debug panel. Measured against high-confidence dermatologist labels:

| P(hives) ≥ | recall | precision | specificity |
|---|---|---|---|
| 0.5 | 0.627 | 0.931 | 0.967 |
| 0.6 | 0.580 | 0.967 | 0.986 |
| **0.7** | **0.500** | **1.000** | **1.000** |
| 0.9 | 0.260 | 1.000 | 1.000 |

At 0.7 it produced **zero false positives across 209 non-urticaria images**. It
is not unreliable. It is conservative, which is a different property, and it is
the right one here: the camera only ever *adds* evidence, so a false positive
propagates into the verdict while a false negative costs nothing, because the
symptom checklist covers whatever the camera misses.

### What changed in the app

`js/hivesModel.js` now exports `hives` (P of the hives class) alongside the old
`reaction` value, and `HIVES_CUE_THRESHOLD = 0.7`. `js/screens/recognize.js`
drives the cue off `P(hives)` instead of `1 - P(normal_skin)`. The old value is
still returned and still shown in the debug panel, so the failure stays visible
instead of being quietly deleted.

### The caveat on all of this

SCIN has no true normal-skin class. The 59 negatives above are photographs
people submitted *because they were worried*, where a dermatologist then saw
nothing. That is a hard negative set, not a clean one, and the real specificity
against a plain photograph of an unaffected forearm is probably better than
0.085. But a detector that fires on 98.6% of everything is not carrying
information in either direction, and that conclusion does not depend on the
negatives being clean.

## The provenance gap we could not close

`js/vision-model/meta.json` claims three classes (`hives`, `other_condition`,
`normal_skin`), 6,987 images, and validation accuracy 0.9215. No training script
was ever committed, so none of that is reproducible.

**SCIN cannot have supplied the `normal_skin` class.** It contains 5,033 cases,
3,061 with a usable label, and no normal-skin category at all beyond the 59
no-pathology gradings. Wherever those normal-skin images came from, no record of
it survives. That is the outstanding work in this directory: source a real
normal-skin dataset, with a licence, and retrain three-class properly.

Until then the shipped weights stay, because the audit shows the `hives` output
is genuinely useful, and the app now relies only on that output.

## The licence was also stated wrong

The code said SCIN is CC BY 4.0. It is not. SCIN is released under a custom
**SCIN Data Use License**, which is CC-BY-derived but adds a clause forbidding
any attempt to re-identify subjects, with automatic termination of rights on
breach. Fixed in `js/hivesModel.js`.

> SCIN dataset, © Google LLC. Licensed under the SCIN Data Use License
> (https://github.com/google-research-datasets/scin/blob/main/LICENSE), provided
> AS-IS without warranties. Source: https://github.com/google-research-datasets/scin
> Cite: Ward A, et al. *JAMA Netw Open* 2024;7(11):e2446615.

SCIN labels are retrospective dermatologist differentials, **not confirmed
clinical diagnoses**. That is a ceiling on any accuracy claim made from them and
should appear next to any number quoted from this data.

## Running it

```bash
npm install                       # tfjs-node, for the audit
pip install -r requirements.txt   # tensorflow, for training

# Reproduce the audit of the currently shipped weights
python fetch_scin.py --out data           # ~5GB, public bucket, no credentials
node audit_shipped_model.js

# Retrain from scratch (needs a GPU to be pleasant)
python train_vision.py --manifest data/manifest.json --out out
tensorflowjs_converter --input_format=tf_saved_model \
  --output_format=tfjs_graph_model out/saved_model ../../js/vision-model
```

`train_vision.py` trains **urticaria vs other skin condition**, because that is
the question SCIN can answer. It splits by case rather than by image, since
2,289 SCIN cases contribute three photographs of the same lesion and splitting
by image would put near-duplicate views on both sides of the boundary. It
reports average precision rather than accuracy, because the positive class is
about 8% and predicting "no" for everything scores 92%.

## Five things that silently break naive SCIN loaders

All handled in `fetch_scin.py`, all verified against the live bucket:

1. The label column is `dermatologist_skin_condition_on_label_name`. The
   official `dataset_schema.md` omits the `_on_` and is wrong.
2. Unlabelled cases carry the literal string `{}`, not NaN. `dropna()` will not
   remove them and you will train on 1,972 empty labels.
3. Label columns are Python literals with single quotes. `json.loads` fails;
   use `ast.literal_eval`.
4. `case_id` needs `dtype={'case_id': str}` or pandas coerces it and the join
   silently drops rows.
5. `dataset/images/-2243186711511406658.png` is referenced but absent from the
   bucket, and 15 paths are referenced by more than one case.

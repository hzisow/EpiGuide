# train/

Everything that produces a model in EpiGuide, plus the evidence it rests on.

    make all      regenerate the symptom model and write ../js/model.js
    make check    verify ../js/model.js matches what this pipeline produces
    make vision   retrain the skin-reaction CNN (slow; see vision/README.md)

Read `METHODS.md` first. It explains where every number came from, what we had
to assume, how the models were validated against real patient cases, and what
they cannot do.

## Layout

    data/symptom_frequencies.json   published symptom rates, one source per number
    data/validation_cases.json      44 real published cases, coded from verbatim quotes
    data/escalation_judgments.json  secondary analysis of what the false alarms were

    src/features.py                 the feature vocabulary; canonical ordering
    src/generate_cohort.py          synthetic cohort simulator
    src/niaid_faan.py               NIAID/FAAN 2006 and WAO 2020 criteria as code
    src/train_symptom_model.py      the fit, threshold calibration, reliability check
    src/evaluate.py                 external validation + sensitivity analysis
    src/export_js.py                writes ../js/model.js

    out/                            generated; validation_report.md is the one to read

## The one rule

`../js/model.js` is generated. Do not edit it by hand. Change the evidence in
`data/`, run `make all`, and commit both. `make check` fails the build if the
committed model.js is not what the pipeline produces.

# EpiGuide symptom model: external validation

Validated on **44 real published patient cases** (27 anaphylaxis, 17 mimics), each coded from a verbatim quote in an open-access case report. The model never saw these cases during fitting and they had no influence on any weight.

## Results

| System | Sensitivity (95% CI) | Specificity (95% CI) | PPV | NPV | Accuracy |
|---|---|---|---|---|---|
| Fitted model alone | 0.889 (0.72–0.96) | 0.706 (0.47–0.87) | 0.828 | 0.800 | 0.818 |
| **Shipped policy (model OR criteria OR red flag)** | 1.000 (0.88–1.00) | 0.412 (0.22–0.64) | 0.730 | 1.000 | 0.773 |
| NIAID/FAAN 2006 criteria (benchmark) | 0.815 (0.63–0.92) | 0.706 (0.47–0.87) | 0.815 | 0.706 | 0.773 |
| WAO 2020 criteria | 0.926 (0.77–0.98) | 0.529 (0.31–0.74) | 0.758 | 0.818 | 0.773 |

Published performance of the NIAID/FAAN benchmark in an emergency-department population, for context: sensitivity 96.7% / specificity 82.4% (Campbell 2012, n=214) and sensitivity 95.1% / specificity 70.8% (Loprinzi Brauer 2016, n=174). Our implementation of the rule cannot use criterion 3, which requires a blood pressure measurement, so it is handicapped relative to those figures.

## Sensitivity to the assumptions

Every value in the frequency table flagged `assumed` is a modelling choice, not a literature finding. Below, the model is refit from scratch with all of them scaled, and with the European trigger mix swapped for a US-weighted one.

| Variant | Model Sn | Model Sp | Shipped Sn | Shipped Sp |
|---|---|---|---|---|
| baseline | 0.889 | 0.706 | 1.000 | 0.412 |
| assumed values x0.5 | 0.889 | 0.588 | 0.963 | 0.353 |
| assumed values x1.5 | 0.815 | 0.765 | 1.000 | 0.471 |
| US-weighted trigger mix | 0.889 | 0.706 | 1.000 | 0.412 |

## Every case the shipped system got wrong

**Missed anaphylaxis (0).** These are the failures that matter.

None.

**False alarms (10).** A false alarm here costs an unnecessary epinephrine dose and an ambulance. That is a real cost, and much smaller than the cost of the misses above.

| Case | Actual diagnosis | p | What escalated it |
|---|---|---|---|
| mimic_scombroid_30f | Scombroid syndrome (histamine fish poisoning), a non-IgE-mediated reac | 0.833 | model, niaid_faan, wao_2020 |
| mimic_acei_lisinopril_80sf | ACE inhibitor-induced (bradykinin-mediated) angioedema | 0.412 | model, niaid_faan, wao_2020, red_flag:throat_tightness |
| mimic_factitious_14f | Factitious disorder; possible but unconfirmed idiopathic angioedema an | 0.790 | model, niaid_faan, wao_2020, red_flag:stridor |
| mimic_vanco_flushing_68m | Vancomycin flushing syndrome (non-IgE-mediated infusion reaction) in a | 0.006 | wao_2020 |
| mimic_cold_urticaria_9m | Acquired cold-induced urticaria (confirmed by TempTest, threshold 18ºC | 0.864 | model, niaid_faan, wao_2020 |
| mimic_covid_urticaria_39f | Acute urticaria as the presenting manifestation of COVID-19 infection | 0.003 | wao_2020 |
| mimic_contact_dermatitis_45f | Acute airborne allergic contact dermatitis to quaternary ammonium comp | 0.152 | none |
| mimic_vasovagal_venipuncture_29m | Vasovagal syncope with sinus arrest triggered by intravenous cannulati | 0.011 | red_flag:collapse+loss_of_consciousness |
| mimic_syncope_covidvax_21f | Neurally mediated (vasovagal) syncope with sinus arrest following COVI | 0.023 | wao_2020, red_flag:collapse+loss_of_consciousness |
| mimic_systemic_mastocytosis_58m | Systemic mastocytosis presenting with recurrent flushing, hypotension  | 0.002 | niaid_faan, wao_2020, red_flag:collapse+loss_of_consciousness |

## What the false alarms actually were

Specificity above counts all 10 escalated mimics as errors, which is the correct primary metric and we are not adjusting it. But those errors are not equivalent. Of the 10 false alarms, **7 were conditions that needed emergency care anyway** (ACE-inhibitor angioedema of the tongue, hereditary angioedema with bowel obstruction, syncope with sinus arrest, an asthma exacerbation with pneumomediastinum, mast cell activation with hypotension). Telling those people to call for help was right advice about the wrong diagnosis.

**3 were genuinely unnecessary escalations**: `mimic_cold_urticaria_9m`, `mimic_covid_urticaria_39f`, `mimic_contact_dermatitis_45f`. Those are the real cost, and the one worth working to reduce.

The per-case reasoning behind that split is in `data/escalation_judgments.json`. It is our judgment, not the source papers', we are not clinicians, and every arguable case was tagged the way that makes our numbers look worse.

## Limits of this validation

- **44 cases is small.** The confidence intervals above are wide and honest about it. This is a prototype-grade check, not a clinical trial.
- **Published case reports are not a random sample.** Journals publish unusual presentations, which makes this set harder than an average day in an emergency department in some ways and easier in others.
- **Coding is from narrative text.** A case report that does not mention a symptom is coded as not observed, which is what the app sees, but it is not the same as the symptom being absent.
- **The negative class is over-represented by mimics.** Real usage will include many people with nothing wrong at all, whom this set does not contain.
- **No real-world prospective use has been evaluated.** Nobody has used this in an actual emergency.

## Reproducing this

```bash
cd train && pip install -r requirements.txt && make all
```

Model artifact git rev: `unknown`, seed `20240816`. Same seed and same frequency table give identical weights.

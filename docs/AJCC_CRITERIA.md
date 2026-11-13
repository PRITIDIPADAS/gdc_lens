# Self-assessment against the AJCC acceptance criteria

The American Joint Committee on Cancer Precision Medicine Core published criteria that a risk model should meet before it is included in AJCC-endorsed tools ([Kattan and colleagues, CA: A Cancer Journal for Clinicians, 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4955656)). There are 13 inclusion criteria and 3 exclusion criteria.

GDC Lens is a research prototype and does not claim to meet them. This page is a self-assessment, written to show where the project stands and what a clinical reviewer should look at first. Criteria are paraphrased, with the article's own words only where marked. The article is the authority on exact wording.

**Summary.** Met: 5 of 13 inclusion criteria. Partly met: 4. Not met: 3. One is for clinical reviewers to judge. Of the exclusion criteria, one applies in part (short follow-up in TCGA), one does not apply, one is borderline (84 deaths in the smallest-event site).

## Inclusion criteria

| # | Criterion (paraphrased) | Status | Where and why |
| ---: | :--- | :--- | :--- |
| 1 | The outcome is overall survival, disease-specific survival or disease-specific mortality | Met | Overall survival from diagnosis, reported as risk of death by 3, 5 and 10 years. |
| 2 | The model answers a clinically relevant question | For reviewers | The question is: what is this patient's risk of death by a given horizon, and is there enough evidence to show it? Whether that is a question clinicians need answered is for them to say. See the questions in [EXPERT_SUPPORT.md](EXPERT_SUPPORT.md). |
| 3 | Relevant predictors are included, or their absence is explained | Partly met | Age, pT, pN, ER, PR and HER2 are in. Grade is present only in METABRIC in the harmonised data, so it is out. Treatment, Ki-67 and genomic scores are not used. Stated under *Limits* on the Methods page. |
| 4 | The validation patients and their selection are described precisely | Met | Eligibility rules in [ANALYSIS_PLAN.md](ANALYSIS_PLAN.md). The flow from 3,607 records to 2,811 analysed patients, and a table per site, are in [RESULTS.md](RESULTS.md). |
| 5 | The model is assessed for generalizability and external validation. “The model should be assessed for generalizability and external validation.” | Partly met | Each of six sites (TCGA-BRCA and five METABRIC cohorts) is held out in turn and scored by a model fitted on the other five, with a pooled estimate and prediction interval. All are retrospective research cohorts. There is no prospective validation. |
| 6 | There is a well-defined prognostic time zero | Partly met | Time is months from diagnosis in every cohort. Stage is known only after surgery, so very early risk is slightly understated (Methods, *Limits*). |
| 7 | Every predictor is known at time zero and defined well enough for others to use | Partly met | pT and pN are pathological, known after surgery. ER, PR and HER2 come from source-specific assays, with an explicit unknown level. The model is meant for use after surgery. |
| 8 | Enough detail is published to implement the model | Met | Coefficients, the age curve and the baseline hazard are in `web/public/data/model.json` and the Methods page. The Predict page and the code implement it. |
| 9 | Discrimination is reported. “A measure of discrimination must have been reported.” | Met | Uno's C and the time-dependent AUC for each held-out site, pooled with a prediction interval (pooled Uno C 0.69, interval 0.62 to 0.76). |
| 10 | Calibration is assessed in the external data. “Calibration in the small must be assessed (from the external validation data set) and provided.” | Met | Observed over expected deaths at 3 years, calibration slope and integrated calibration index for every held-out site. The level of risk is the weak point: observed over expected ranges from 0.51 to 1.60 across sites. |
| 11 | The model is validated over a time frame and practice setting relevant to contemporary patients. “The model should be validated over a time frame and practice setting that is relevant to contemporary patients with disease.” | Not met | The public cohorts are older. The Hospital page lets a centre run the checks on its own recent patients without uploading anything. |
| 12 | The initial treatments given, and how often, are clear | Not met | Treatment is not in the model and is not harmonised across the cohorts. Only neoadjuvant therapy is used, to exclude 2 patients. |
| 13 | The development or validation appears in a peer-reviewed journal | Not met | Not published. A preprint and a public methods discussion are the intended first steps ([EXPERT_SUPPORT.md](EXPERT_SUPPORT.md)). |

## Exclusion criteria

| # | Criterion (paraphrased) | Status | Where and why |
| ---: | :--- | :--- | :--- |
| E1 | A substantial share of validation patients have essentially no follow-up | Applies in part | TCGA-BRCA has a median follow-up of about 30 months, and 56% of its patients have no known 3-year status. The analysis is built around this: censoring-weighted measures, horizons limited to where the data support them, and a label audit. The five METABRIC cohorts have median follow-up of 131 to 249 months. |
| E2 | The number of missing values in the validation data is not reported | Does not apply | Counts of records left out for each missing field are in the flow table in [RESULTS.md](RESULTS.md). Unknown receptor status is a level of the model. |
| E3 | The number of events in the validation data is small (about 100 is suggested as a minimum) | Borderline | Deaths per held-out site: TCGA-BRCA 84, METABRIC 1 209, METABRIC 2 148, METABRIC 3 506, METABRIC 4 122, METABRIC 5 106. Only TCGA-BRCA is below 100. Pooled, 1,175 deaths. |

## What would change the picture

1. Recent patients from a treating centre, scored with the Hospital page (criterion 11, and 12 if treatment is recorded).
2. Disease-specific survival where cause of death is recorded, which would separate breast cancer deaths from other deaths at older ages.
3. A peer-reviewed write-up (criterion 13).

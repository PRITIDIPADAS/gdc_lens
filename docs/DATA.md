# Data

All analyses use public clinical tables. No patient-level data are collected by the website, and the Hospital page reads a file in the browser without sending it anywhere.

## Sources

| Source | What was used | How it was obtained |
| :--- | :--- | :--- |
| NCI Genomic Data Commons, project TCGA-BRCA | Clinical records: vital status, days to death, days to last follow-up, age at diagnosis, pathological T, N and M, year of diagnosis | One request to the public `cases` endpoint of the GDC API, run by `scripts/fetch_data.py`. Data release 46. |
| cBioPortal study `brca_metabric` | Clinical patient and sample tables for METABRIC, split into five cohorts by the `COHORT` field | Public cBioPortal datahub, run by `scripts/fetch_data.py`. |
| cBioPortal studies `brca_tcga` and `brca_tcga_pan_can_atlas_2018` | ER, PR and HER2 status for TCGA-BRCA patients, which the GDC clinical fields do not carry | Same script. |

The tables in `data/raw/` are the copies used for the published results. They are public downloads, kept here so the results can be reproduced. Each source has its own terms of use, which apply to any reuse. Re-running the fetch writes new files, and the numbers can move if a source has changed its records.

References: The Cancer Genome Atlas Network, Nature 2012 (TCGA breast cancer); Curtis and colleagues, Nature 2012, and Pereira and colleagues, Nature Communications 2016 (METABRIC); Grossman and colleagues, New England Journal of Medicine 2016 (the Genomic Data Commons).

## Common data model

One row per patient, built by `gdclens/data.py`:

| Field | Definition |
| :--- | :--- |
| `site` | TCGA, or M1 to M5 for the METABRIC cohorts. METABRIC cohorts 6 to 9 have no survival data and drop out at eligibility. |
| `age` | Age at diagnosis in years. |
| `T` | Pathological T: 1, 2, or 3 (T3 and T4 together). |
| `N` | Pathological N: 0 to 3. For METABRIC it is derived from the count of positive nodes. |
| `ER`, `PR`, `HER2` | Positive, negative or unknown. |
| `time`, `event` | Months from diagnosis to death or last follow-up; 1 for death from any cause, 0 for censored. For a living GDC patient, the latest of the recorded follow-up days. |

Eligibility: non-metastatic invasive breast cancer, known age, pT and pN, follow-up time above zero, no neoadjuvant therapy (where pT and pN are measured after treatment). 3,607 records enter and 2,811 patients are analysed; the count lost at each step is in [RESULTS.md](RESULTS.md).

Grade is recorded only for METABRIC in the harmonised data and is not used.

## Sex, race and ancestry

The GDC `gender` field is empty for all 1,098 TCGA-BRCA cases in data release 46, so sex is not used and the cohort cannot be checked for differences by sex. `scripts/fetch_data.py` prints the count of empty values each time it runs. Race is recorded for nearly every case (95 are marked not reported) but is not a predictor, and no result is reported by group, because the cohorts are too small to do that reliably.

## Follow-up

| Site | Median follow-up (months) |
| :--- | ---: |
| TCGA-BRCA | 30 |
| METABRIC 1 | 131 |
| METABRIC 2 | 249 |
| METABRIC 3 | 222 |
| METABRIC 4 | 140 |
| METABRIC 5 | 221 |

Median follow-up is estimated by reverse Kaplan-Meier, which treats the end of follow-up as the event. TCGA-BRCA is short: 56% of its patients have no known 3-year status. That is why the project reports censoring-aware measures and a label audit, and why 5 and 10 year numbers for TCGA rest on few patients.

## Synthetic example file

`web/public/demo_hospital.csv` has 1,500 synthetic patients, simulated with a seeded script for the Hospital page and its tests. It contains no real patient data.

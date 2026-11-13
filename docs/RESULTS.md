# Results

Built by the script `scripts/make_results_md.py` from `web/public/data/results.json`, which `scripts/export_web.py` writes from the tables in `results/`.
Do not edit by hand. Pre-specified analysis: [ANALYSIS_PLAN.md](ANALYSIS_PLAN.md). Changes made afterwards: [DEVIATIONS.md](DEVIATIONS.md).
Research use only.

## Data

| Site | Source | Patients | Deaths | Median follow-up (months) | Median age | ER+ | HER2+ | pN0 | Mortality 3 y | Mortality 5 y |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TCGA-BRCA | GDC | 926 | 84 | 30 | 59 | 74% | 17% | 49% | 6.1% | 12.8% |
| METABRIC 1 | cBioPortal | 479 | 209 | 131 | 61 | 83% | 10% | 45% | 11.7% | 22.4% |
| METABRIC 2 | cBioPortal | 286 | 148 | 249 | 57 | 71% | 14% | 57% | 10.1% | 18.9% |
| METABRIC 3 | cBioPortal | 727 | 506 | 222 | 64 | 77% | 12% | 58% | 11.2% | 22.3% |
| METABRIC 4 | cBioPortal | 236 | 122 | 140 | 61 | 76% | 13% | 42% | 11.1% | 21.9% |
| METABRIC 5 | cBioPortal | 157 | 106 | 221 | 67 | 75% | 15% | 56% | 14.7% | 25.7% |

| Step | Patients |
| :--- | ---: |
| In the source files | 3,607 |
| Left out: no survival time/status | 530 |
| Left out: follow-up time not positive | 22 |
| Left out: age missing | 46 |
| Left out: pT missing, Tis or TX | 98 |
| Left out: pN missing or NX | 82 |
| Left out: metastatic at diagnosis (M1) | 16 |
| Left out: neoadjuvant therapy (pT/pN post-treatment) | 2 |
| Analysed | 2,811 |

The GDC gender field is empty for every TCGA-BRCA case in release 46, so sex is not used.

## Hypotheses

**H1. Binary labels misstate mortality when follow-up is short: supported.** In TCGA (median follow-up 30 months, 56% of patients with unknown 36-month status) censored-as-alive gives 3.8% against a Kaplan-Meier 6.1% at 36 months (bias -2.3 points, 95% CI -3.3 to -1.5); dropping censored patients gives 8.6%. At 60 months: 5.9% and 20.8% against 12.8%. In METABRIC the 36-month bias is -0.15 points.

**H2. Discrimination transports; calibration-in-the-large does not: supported.** Held-out Uno C 0.693 (95% CI 0.654-0.731; prediction interval 0.621-0.764). Calibration slope 0.94 (prediction interval 0.68-1.20). Observed/expected 36-month mortality pools to 1.03 but varies from site to site: I-squared 81%, prediction interval 0.40-2.66.

**H3. Re-estimating one scalar locally reduces calibration error: partly supported.** With 100 local patients the 36-month error fell in TCGA, M2 (TCGA 5.8 to 2.7 points; M2 3.9 to 2.7 points) and rose in M1, M3, M4, M5, where the transported model was already close (M1 1.0 to 2.8; M3 1.7 to 2.1; M4 1.5 to 2.6; M5 2.5 to 4.3). The estimate is noisy because only a handful of deaths occur by 36 months in 100 patients.

**H4. Passport verdicts identify where calibration fails: not supported.** Absolute calibration gap in ABSTAIN minus SHOW groups: 2.0 points (permutation p = 0.40); CAUTION minus SHOW: 0.5 points (p = 0.81). The verdicts describe how much evidence exists, not where the model is wrong.

**H5. A risk threshold chosen on other sites keeps false reassurance within 5%: supported.** Observed 36-month mortality among reassured patients was at or below 5% in 5 of 6 held-out sites (range 0.0-5.9%), with coverage 21-62%. With the minimum set size fixed in the plan (100 patients) no threshold could be certified in 4 of 6 folds.

## Held-out performance of the deployed model

Each row is a site the model never saw: the model is fitted on the other five. Three-year horizon.

| Held-out site | Patients | Deaths | Uno C | AUC 3 y | Brier skill 3 y | Observed / expected 3 y | Calibration slope | ICI 3 y |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TCGA-BRCA | 926 | 84 | 0.718 | 0.727 | 0.006 | 0.51 | 1.09 | 0.054 |
| METABRIC 1 | 479 | 209 | 0.725 | 0.703 | 0.033 | 0.92 | 0.97 | 0.020 |
| METABRIC 2 | 286 | 148 | 0.703 | 0.756 | 0.028 | 1.60 | 0.95 | 0.039 |
| METABRIC 3 | 727 | 506 | 0.652 | 0.667 | 0.031 | 1.18 | 0.79 | 0.020 |
| METABRIC 4 | 236 | 122 | 0.703 | 0.736 | 0.055 | 1.11 | 1.12 | 0.011 |
| METABRIC 5 | 157 | 106 | 0.658 | 0.696 | 0.092 | 1.18 | 1.00 | 0.023 |
| **Pooled (95% interval)** |  |  | 0.693 (0.654 to 0.731) | 0.705 (0.664 to 0.747) | 0.036 (0.008 to 0.064) | 1.03 (0.69 to 1.53) | 0.94 (0.80 to 1.09) |  |
| **95% prediction interval** |  |  | 0.621 to 0.764 | 0.661 to 0.750 | 0.005 to 0.066 | 0.40 to 2.66 | 0.68 to 1.20 |  |
| **I-squared** |  |  | 34% | 0% | 0% | 81% | 29% |  |

## Benchmarks

Same inputs, same held-out sites. For ranking, the flexible models do not beat the small Cox model: the paired differences in Uno C below favour the Cox model or cannot be told from zero. The random survival forest has the higher Brier skill, so the Cox model is not claimed to be the most accurate in every respect. It is the one that can be checked on every input.

| Model | Held-out Uno C (95% interval) | Prediction interval | AUC 3 y | Brier skill 3 y | Observed / expected 3 y |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Stage group (Cox) | 0.668 (0.637 to 0.699) | 0.635 to 0.702 | 0.689 | 0.035 | 1.03 |
| Age and stage group (Cox) | 0.660 (0.614 to 0.705) | 0.568 to 0.751 | 0.670 | 0.018 | 1.04 |
| Deployed model (Cox) | 0.693 (0.654 to 0.731) | 0.621 to 0.764 | 0.705 | 0.036 | 1.03 |
| Random survival forest | 0.683 (0.647 to 0.719) | 0.622 to 0.744 | 0.698 | 0.073 | 1.01 |
| Gradient-boosted survival | 0.674 (0.631 to 0.718) | 0.587 to 0.762 | 0.689 | 0.035 | 1.01 |

| Paired difference in Uno C | Pooled | 95% interval | Prediction interval | I-squared |
| :--- | ---: | ---: | ---: | ---: |
| Deployed model minus stage group | +0.022 | -0.021 to +0.065 | -0.064 to +0.109 | 50% |
| Deployed model minus age and stage group | +0.031 | +0.011 to +0.052 | -0.012 to +0.075 | 56% |
| Deployed model minus random survival forest | +0.007 | -0.001 to +0.015 | -0.002 to +0.016 | 0% |
| Deployed model minus gradient-boosted survival | +0.014 | +0.002 to +0.026 | -0.006 to +0.034 | 26% |

## Label audit

Censored patients treated as survivors, or dropped, against the Kaplan-Meier estimate.

| Cohort | Horizon | Median follow-up (months) | Status unknown | Kaplan-Meier | Censored as alive | Bias, points (95% CI) | Censored dropped | Bias, points (95% CI) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TCGA-BRCA | 3 y | 30 | 56% | 6.1% | 3.8% | -2.3 (-3.3 to -1.5) | 8.6% | +2.5 (+1.7 to +3.5) |
| TCGA-BRCA | 5 y | 30 | 71% | 12.8% | 5.9% | -6.9 (-9.1 to -4.8) | 20.8% | +7.9 (+5.7 to +10.1) |
| METABRIC 1 | 3 y | 131 | 5% | 11.7% | 11.3% | -0.4 (-0.6 to -0.2) | 11.9% | +0.2 (+0.1 to +0.4) |
| METABRIC 1 | 5 y | 131 | 8% | 22.4% | 21.3% | -1.1 (-1.5 to -0.7) | 23.1% | +0.8 (+0.5 to +1.1) |
| METABRIC 3 | 3 y | 222 | 1% | 11.2% | 11.1% | -0.1 (-0.1 to -0.0) | 11.2% | +0.0 (+0.0 to +0.1) |
| METABRIC 3 | 5 y | 222 | 2% | 22.3% | 22.1% | -0.2 (-0.4 to -0.1) | 22.5% | +0.1 (+0.0 to +0.3) |

## Safe-to-reassure rule

A risk threshold chosen on out-of-fold predictions so that the upper 95% limit of observed 3-year mortality among reassured patients stays within the accepted miss rate. Minimum set size 250 (Deviation 2).

| Accepted miss rate | Risk threshold (3 y) | Patients reassured | n reassured | Deaths among them | Observed 3-year mortality (95% interval) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 5.0% | 0.068 | 40% | 1,120 | 40 | 4.0% (2.8% to 5.2%) |
| 7.5% | 0.097 | 62% | 1,740 | 98 | 6.4% (5.2% to 7.6%) |
| 10.0% | 0.227 | 92% | 2,590 | 202 | 9.0% (7.8% to 10.2%) |

## Evidence passport

| Verdict | Training patients (held-out evaluation) | Share | Profiles in the audit grid | Share |
| :--- | ---: | ---: | ---: | ---: |
| Show | 835 | 30% | 180 | 0.7% |
| Show with caution | 791 | 28% | 435 | 1.8% |
| Abstain | 1,185 | 42% | 24,009 | 97.5% |

Permutation tests of whether the verdict locates calibration failures at held-out sites: abstain minus show, 2.0 points (p = 0.40); caution minus show, 0.5 points (p = 0.81).

## Audit of the deployed model

24,624 profiles checked; 24,370 pass every rule. Failures: hazard-ratio bound 254, all other enforced rules 0. The advisory rule on unknown receptors fails for 13,680 profiles by design (see Methods).

## Live check against the GDC

Snapshot taken when the site was built (GDC data release 46): 926 patients, 84 deaths, median follow-up 29.8 months. The reduced model (age, pT and pN, fitted to METABRIC only) has Uno C 0.670 and AUC at 3 years 0.692 on TCGA. Observed 3-year mortality is 6.1% against 11.2% predicted (observed over expected 0.54); the local factor is 0.55 (0.39 to 0.77).

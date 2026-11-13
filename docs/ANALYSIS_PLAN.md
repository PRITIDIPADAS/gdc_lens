# Analysis plan

Written 2026-11-09, committed before any cross-site model was fitted. Git history is the timestamp.
Any later change is recorded in `docs/DEVIATIONS.md`.

**Status of what was already seen.** Cohort harmonisation and the descriptive label-bias audit (H1) were run
before this plan was written. No model fitting, cross-site validation, recalibration, passport or rule-out
analysis had been run.

## Question

Does a prognostic model for non-metastatic breast cancer that looks good inside one cohort remain usable in
another hospital, and what does a hospital need to do locally to make it safe?

## Data

| Site | Source | Notes |
|---|---|---|
| TCGA | NCI Genomic Data Commons, project TCGA-BRCA (clinical, user-pulled) plus cBioPortal receptor tables | short follow-up |
| M1..M5 | cBioPortal `brca_metabric`, split by the `COHORT` field | long follow-up; five recruiting centres |

Endpoint: overall survival from diagnosis. Eligibility: non-metastatic, known age, pT, pN, follow-up > 0,
no neoadjuvant therapy. Harmonised pT 1/2/3+ (T4 merged into 3+), pN 0-3, ER/PR/HER2 positive/negative/unknown.
Leave-one-site-out (LOCO) over the six sites; a model never sees the site it is tested on.

## Estimands (per held-out site, horizons h = 36 and 60 months; 120 where the site supports it)

* Uno concordance, truncated at tau = min(60, latest t with censoring-survival G(t) >= 0.10), within site.
* Cumulative/dynamic AUC at h.
* IPCW Brier score and skill against the site's own Kaplan-Meier reference.
* Calibration-in-the-large: observed (Kaplan-Meier) versus mean predicted risk at h, ratio O/E.
* Calibration slope (Cox on the linear predictor) and integrated calibration index at 36 months.
* Uncertainty: bootstrap (200 resamples) for discrimination and Brier; delta method for ln(O/E); Cox standard error for the slope.
* Pooling over sites: DerSimonian-Laird random effects with Hartung-Knapp interval, tau^2, I^2 and a 95% prediction interval (t with k-2 df).

## Models (fixed before looking at results; no tuning)

| Id | Model |
|---|---|
| stage | Cox on AJCC anatomic stage group derived from pT/pN (IA, IIA, IIB, IIIA, IIIB+) |
| age_stage | Cox on restricted cubic spline of age (4 knots at training-pool quantiles .05/.35/.65/.95) plus stage |
| clinical | **Deployed model.** Cox on age spline, ordinal pT and pN as thermometer indicators with non-negative increments, ER, PR, HER2 indicators (negative, unknown) |
| rsf | Random survival forest, 300 trees, min leaf 20, sqrt features; same inputs |
| gbsa | Gradient-boosted Cox, 200 trees, depth 2, learning rate 0.05, subsample 0.7; same inputs |

The deployed model is fixed in advance because it is lookup-table exportable and can be audited exhaustively.
Whether its receptor inputs add anything is tested, not assumed: paired site-level difference in Uno C
(clinical minus age_stage and minus stage), pooled as above. The ML benchmarks answer whether flexible models
add discrimination with identical inputs.

## Hypotheses

**H1 - label bias.** With censoring-unaware labels, 36- and 60-month mortality is biased in short-follow-up
cohorts and not in long-follow-up cohorts. Censored-as-alive underestimates; drop-censored overestimates.
Measure: naive minus Kaplan-Meier with bootstrap 95% interval (1,000), per site. A Weibull simulation with exact
truth maps bias against follow-up length. Binary-label AUC is compared with censoring-weighted AUC to see whether
model rankings change.

**H2 - transport.** Discrimination transports; calibration-in-the-large does not.
Supported if the pooled O/E has I^2 > 50% or a prediction interval excluding 1, while the pooled calibration
slope has a prediction interval containing 1.

**H3 - local recalibration.** Re-estimating one scalar, kappa = observed / expected deaths to the horizon
(pooled Breslow baseline as offset, exact Poisson interval), on n_local local patients reduces the absolute
36-month calibration error against doing nothing. n_local in {25, 50, 100, 200, 400}, 200 random subsamples per
site, evaluated on the remaining patients. Reported: median error and the share of subsamples within
2 percentage points, giving sample-size guidance. kappa is conditional on the fixed pooled model, which is what a
hospital adopting it experiences.

**H4 - evidence passport.** For every patient the passport is computed from the training pool only.
Components and a-priori traffic lights:

| Component | Green | Red |
|---|---|---|
| Support: similar training patients (same categories, age within 5 years) | >= 30 | < 10 |
| Stability: SD across leave-one-site-out refits of the log hazard ratio against a reference profile | <= 0.15 | > 0.30 |
| Precision: bootstrap 95% interval width of the 36-month risk (200 refits) | <= 0.10 | > 0.20 |
| Local calibration: gap between mean out-of-fold prediction and Kaplan-Meier in similar patients (age within 10) | gap <= 0.05 or |z| <= 1 | gap > 0.10 and |z| > 2 |
| Rules: profile passes the clinical-rule audit | pass | fail |

Verdict: ABSTAIN if any red, SHOW if all green, otherwise SHOW WITH CAUTION. A shuffled-label canary (C near
0.5) guards the pipeline. Validity test in held-out sites: absolute calibration gap (mean predicted versus
Kaplan-Meier risk) by verdict group, compared with a permutation null that shuffles verdicts within
predicted-risk deciles, so group size and risk level cannot explain a difference.

**H5 - safe reassurance.** A threshold lambda on predicted 36-month risk is chosen from out-of-fold predictions
of the training pool as the largest value such that the upper 95% limit of Kaplan-Meier mortality among patients
below it stays <= 5% (first-violation rule, minimum 100 patients). In held-out sites, the false-reassurance rate
(observed 36-month mortality among reassured patients) is reported with coverage, before and after a
kappa update with 100 local patients. Supported if the point estimate is <= 5% in at least 5 of 6 sites.

## Exhaustive audit

All 24,624 input profiles (ages 20-95 x pT 3 x pN 4 x ER 3 x PR 3 x HER2 3) are checked against: risk
non-decreasing in pT and pN, in horizon, and in age from 45; probabilities within [0, 1]; hazard ratio versus
reference bounded. The shipped lookup table is re-derived in the browser from the coefficients and compared.

## Reporting

All pre-specified results are reported whatever their direction. Exploratory analyses (METABRIC-only
predictor ladder, post-baseline treatment leakage demonstration, endpoint sensitivity) are labelled as such.
Random seeds are fixed in `scripts/run_all.py`.

## Limits stated in advance

Overall survival mixes cancer and other-cause deaths, which dominate older METABRIC patients. METABRIC and TCGA
differ in era, treatment and assay. pT and pN in METABRIC are derived from size and node counts. Cohort 6-9 of
METABRIC has no survival data. Not a medical device; research use only.

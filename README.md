# GDC Lens

**Does a breast cancer prognosis model that works in one cohort hold up in another hospital, and what should a hospital do before trusting it?**

GDC Lens answers with open data: TCGA-BRCA from the NCI Genomic Data Commons and five METABRIC cohorts. Every site is held out in turn, patients who are still alive are never labelled survivors, and every estimate carries a check on how much evidence stands behind it. Everything runs in the browser.

> **Research use only.** Not a medical device. Not for decisions about individual patients. Not validated prospectively.

**Site:** <https://pritidipadas.github.io/gdc_lens/>

| Page | What it does |
| :--- | :--- |
| Predict | Risk of death by 3, 5 and 10 years from age, pT, pN, ER, PR and HER2, with an evidence verdict: show, show with caution, or withhold the estimate. |
| Evidence | Held-out performance at each of the six sites, pooled with a prediction interval, with calibration and decision curves. |
| Label audit | What treating censored patients as survivors, or dropping them, does to mortality estimates. Includes a simulation that runs in the tab. |
| Hospital | Load a CSV of a centre's own patients and get the same checks, a local correction, and a report. The file never leaves the browser. An example file is built in. |
| Live GDC | Re-runs the headline checks on the current GDC records with a model that never saw TCGA. |
| Methods | The model, the measures, the audit of all 24,624 input profiles (re-derivable in the tab), limits, and published support for the methods. |

## What it found

Six sites: 2,811 patients, 1,175 deaths. Full tables are in [docs/RESULTS.md](docs/RESULTS.md).

- **Ranking transports.** Pooled Uno C on held-out sites is 0.69 (95% interval 0.65 to 0.73, prediction interval 0.62 to 0.76).
- **The level of risk does not.** Observed over expected 3-year deaths pools to 1.03 but ranges from 0.51 to 1.60 across sites (I-squared 81%, prediction interval 0.40 to 2.66).
- **Censored is not alive.** In TCGA, where median follow-up is 30 months and 56% of patients have no known 3-year status, counting them as survivors gives 3.8% 3-year mortality against 6.1% by Kaplan-Meier. Dropping them gives 8.6%.
- **A one-number local correction is not free.** Rescaling the baseline hazard from 100 local patients reduced the 3-year error at 2 of 6 sites and increased it at 4 where the model was already close.
- **An evidence check describes the data, not the errors.** Per-profile verdicts did not locate where calibration failed at held-out sites (difference 2.0 points, permutation p = 0.40).
- **A reassurance threshold chosen on other sites held.** Observed 3-year mortality among reassured patients was at or below 5% at 5 of 6 held-out sites.
- **The small Cox model is competitive for ranking.** A random survival forest and gradient-boosted survival model did not beat it on Uno C; the forest has the better Brier skill.

Negative and partial results are reported as such. Each hypothesis and its criterion were fixed in [docs/ANALYSIS_PLAN.md](docs/ANALYSIS_PLAN.md) before any cross-site model was fitted, and every later change is in [docs/DEVIATIONS.md](docs/DEVIATIONS.md).

## How it was checked

- 29 Python tests, 24 JavaScript tests and 14 browser tests, all run in CI.
- The browser code is compared with the Python code on the same inputs: Kaplan-Meier, censoring weights, Uno C, AUC, calibration, the local factor and its exact interval, the deployed model on 150 profiles, the audit counts on all 24,624 profiles, and the Hospital page on the example file.
- The Methods page re-derives the published audit in the viewer's browser.

## Documents

| File | Content |
| :--- | :--- |
| [docs/ANALYSIS_PLAN.md](docs/ANALYSIS_PLAN.md) | Questions, estimands, models and decision rules, written before the results |
| [docs/DEVIATIONS.md](docs/DEVIATIONS.md) | Every change since, and whether it was decided after seeing results |
| [docs/RESULTS.md](docs/RESULTS.md) | All result tables, built from the code |
| [docs/DATA.md](docs/DATA.md) | Sources, harmonisation, follow-up, and what the data lack (sex is empty in GDC release 46) |
| [docs/AJCC_CRITERIA.md](docs/AJCC_CRITERIA.md) | Self-assessment against the AJCC acceptance criteria for risk models |
| [docs/TRIPOD_PROBAST.md](docs/TRIPOD_PROBAST.md) | Reporting checklist and risk-of-bias self-assessment |
| [docs/EXPERT_SUPPORT.md](docs/EXPERT_SUPPORT.md) | Published statements by methodologists and clinical bodies about these methods, and public ways to ask for a review |

## Run it

```bash
git clone https://github.com/PRITIDIPADAS/gdc_lens
cd gdc_lens
pip install -e ".[dev]"
python -m pytest                 # Python tests
python scripts/fetch_data.py     # optional: download the source tables again (public data)
python scripts/run_all.py        # every analysis, writes results/
python scripts/export_web.py     # writes the data the site loads
python scripts/make_results_md.py
cd web
npm ci
npm test                         # parity tests against the Python code
npm run build                    # static site in web/dist
npx vite preview                 # open the printed address
```

Browser tests: `npm i --no-save playwright && npx playwright install chromium && node tests/e2e.mjs` from `web/`. Seeds are fixed, so `run_all.py` reproduces the committed tables.

## Layout

```
gdclens/     Python package: data harmonisation, Cox model, censoring-aware measures,
             label audit, leave-one-site-out transport, evidence passport, reassurance rule, audit
scripts/     fetch, run, export and document generators
tests/       Python tests
data/raw/    source tables (public downloads)
results/     tables written by run_all.py
web/         static site, plain JavaScript with Vite, no server
docs/        plan, deviations, results, data notes, review aids
```

## Limits

The cohorts are older and retrospective, treatment is not modelled, the model has six predictors, TCGA follow-up is short, and the endpoint is death from any cause. These and more are listed on the Methods page under *Limits and intended use*.

## Feedback

Use the [clinical or statistical review form](https://github.com/PRITIDIPADAS/gdc_lens/issues/new/choose), or the ten-minute checklist in [docs/EXPERT_SUPPORT.md](docs/EXPERT_SUPPORT.md).

## Cite and licence

See [CITATION.cff](CITATION.cff). Code is MIT licensed ([LICENSE](LICENSE)). The site bundles the Fraunces, Inter and JetBrains Mono typefaces through Fontsource under the SIL Open Font License 1.1. Source data keep the terms of their providers (see [docs/DATA.md](docs/DATA.md)).

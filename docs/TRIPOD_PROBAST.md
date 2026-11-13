# Reporting and risk-of-bias self-assessment

Two public tools are used to report and appraise prediction model studies. This page maps both to the project, with the gaps stated. It is a self-assessment and has not been checked by anyone else.

- **TRIPOD**, a 22-item reporting checklist: Collins, Reitsma, Altman and Moons, BMJ 2015;350:g7594, [the TRIPOD statement](https://www.bmj.com/content/350/bmj.g7594).
- **PROBAST**, a tool to assess risk of bias and applicability, with 20 signalling questions in four domains (participants, predictors, outcome, analysis): Moons, Wolff, Riley and colleagues, Annals of Internal Medicine 2019, [explanation and elaboration](https://research-information.bris.ac.uk/en/publications/probast-a-tool-to-assess-risk-of-bias-and-applicability-of-predic/).

## TRIPOD

Study type: the leave-one-site-out evaluation is a repeated validation on a non-random split by location (internal–external cross-validation). The Hospital page is validation only, on a file the user brings.

| Item | Topic | Where it is addressed |
| :--- | :--- | :--- |
| 1 | Title | The package description names the work as an evaluation of breast cancer prognostic models. Partly: no formal title page. |
| 2 | Abstract | The README summary. Partly: not in the structured form. |
| 3a, 3b | Background, objectives | README; the *Question* section of [ANALYSIS_PLAN.md](ANALYSIS_PLAN.md). |
| 4a, 4b | Source of data, key dates | [DATA.md](DATA.md). GDC data release 46. The accrual dates of the source cohorts are as described by their sources. |
| 5a, 5b | Setting, eligibility | [DATA.md](DATA.md); *Data* in the analysis plan. Retrospective research cohorts, no prospective recruitment. |
| 5c | Treatments | Not reported. Treatment is not harmonised across cohorts (see [AJCC_CRITERIA.md](AJCC_CRITERIA.md), criterion 12). |
| 6a, 6b | Outcome and blinding | Death from any cause, counted from diagnosis. Blinding is not relevant to an objective endpoint in retrospective records. |
| 7a, 7b | Predictors and blinding | Age, pT, pN, ER, PR and HER2, defined in [DATA.md](DATA.md). Blinding is not relevant. |
| 8 | Sample size | All eligible patients. 1,175 deaths for 14 fitted coefficients, about 84 per coefficient. |
| 9 | Missing data | Records missing a core field are left out and counted ([RESULTS.md](RESULTS.md)). Unknown receptors are a level of the model. |
| 10a | Predictor handling | Age as a restricted cubic spline, made monotone from 45 (Deviation 1); pT and pN as cumulative steps; receptors with an unknown level. |
| 10b | Model type, internal validation | Cox proportional hazards with a Breslow baseline. Leave-one-site-out validation. |
| 10c | How predictions were made in validation | The model is fitted on five sites and applied unchanged to the sixth. |
| 10d | Performance measures | Uno's C, time-dependent AUC, censoring-weighted Brier score and skill, observed over expected, calibration slope, integrated calibration index, decision curves. Methods page, *The measures*. |
| 10e | Model updating | One local factor on the baseline hazard. [RESULTS.md](RESULTS.md), hypothesis 3. |
| 11 | Risk groups | The safe-to-reassure rule and the evidence passport verdicts ([RESULTS.md](RESULTS.md)). |
| 12 | Development against validation differences | Case mix per site in [RESULTS.md](RESULTS.md); the Hospital page prints the case mix of a file beside its results. |
| 13a | Flow of participants | The exclusion table in [RESULTS.md](RESULTS.md). |
| 13b, 13c | Characteristics and comparison | The cohort table: age, ER, HER2, pN0, mortality, follow-up. |
| 14a, 14b | Numbers and unadjusted associations | Patients and deaths per site are reported. Unadjusted associations are not reported. |
| 15a, 15b | Full model and how to use it | The Methods page and `web/public/data/model.json` give every coefficient and the baseline hazard. The Predict page applies them. |
| 16 | Performance with intervals | [RESULTS.md](RESULTS.md) and the Evidence page. |
| 17 | Updating results | [RESULTS.md](RESULTS.md), hypothesis 3, and `results/recal_summary.csv`. |
| 18 | Limitations | The Methods page, *Limits and intended use*. |
| 19a, 19b | Interpretation | The hypotheses in [RESULTS.md](RESULTS.md): what was supported, partly supported and not supported. |
| 20 | Implications | README and the Hospital page. Partly: no statement of a clinical pathway. |
| 21 | Supplementary information | The analysis plan, the deviations log, the results folder and the code, all in this repository. |
| 22 | Funding | No funding is declared in this repository. |

## PROBAST

Ratings are the project's own. "High" means a reviewer should expect bias unless shown otherwise.

| Domain | Risk of bias | Reasons |
| :--- | :--- | :--- |
| Participants | High | Retrospective research cohorts, not consecutive series, and tissue and record availability shape who is included. About 22% of source records were left out for missing core fields (3,607 to 2,811). |
| Predictors | Unclear | Definitions are harmonised across sources, but receptor assays differ by source and pT and pN are known only after surgery. |
| Outcome | Unclear | Death from any cause is objective, but vital status is ascertained differently by source and TCGA follow-up is short. Censoring is handled by weighting, not by labels. |
| Analysis | Unclear | Strengths: censoring-aware measures, calibration and discrimination, site-level validation with a prediction interval, thresholds fixed in a plan written before the results. Weaknesses: the shipped model is fitted on all six sites, and there is no prospective or recent-practice validation. |

Applicability to a clinic treating patients today: concern, because the cohorts are older and treatment is not modelled.

Overall: high risk of bias because of the participants domain. The project is positioned as a research prototype and says so on every page.

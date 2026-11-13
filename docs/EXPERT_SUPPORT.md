# Published support for this kind of evaluation

Methodologists and clinical bodies have written about the practices GDC Lens is built on: testing a prognostic model on sites it has not seen, reporting calibration beside ranking, correcting the level of risk locally, handling censored patients properly, and showing when an estimate should not be trusted. This page collects short quotations with links. The same list appears on the Methods page of the site.

What this page is, and is not:

- These are statements about methods in general. None of the authors has seen or reviewed GDC Lens, and nothing here is an endorsement of it.
- Each quotation was copied from the abstract or text of the page it links to on 11 and 12 November 2026. Quotations are kept short on purpose. Marks of omission (…) show where a sentence continues or where two sentences are joined. Inner quotation marks are shown as single marks.
- The AJCC criteria are criteria for including a model in AJCC-endorsed tools. GDC Lens is a research prototype and does not meet all of them. The item-by-item self-assessment, including what is not met, is in [AJCC_CRITERIA.md](AJCC_CRITERIA.md).

### Testing on sites the model has not seen

> “Every study is left out once, for validation of a model based on the remaining studies.”
>
> Steyerberg and Harrell, Journal of Clinical Epidemiology, 2016. [Prediction models need appropriate internal, internal–external, and external validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC5578404)

Used here: Leave-one-site-out validation over six sites.

> “Hence, we have to expect heterogeneity in model performance between locations and settings, and across time. It follows that prediction models are never truly validated.”
>
> Van Calster, Steyerberg, Wynants and van Smeden, BMC Medicine, 2023. [There is no such thing as a validated prediction model](https://cris.maastrichtuniversity.nl/en/publications/there-is-no-such-thing-as-a-validated-prediction-model/)

Used here: Each site is scored on its own and pooled with a prediction interval. The Live and Hospital pages exist because of the second sentence.

> “The model should be assessed for generalizability and external validation.”
>
> Kattan and colleagues for the AJCC Precision Medicine Core, CA: A Cancer Journal for Clinicians, 2016. [American Joint Committee on Cancer acceptance criteria for inclusion of risk models for individualized prognosis in the practice of precision medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC4955656)

Used here: Six held-out sites. The AJCC list is checked item by item in docs/AJCC_CRITERIA.md.

### Calibration, and correcting it locally

> “… poorly calibrated algorithms can be misleading and potentially harmful for clinical decision-making”
>
> Van Calster, McLernon, van Smeden, Wynants and Steyerberg, BMC Medicine, 2019. [Calibration: the Achilles heel of predictive analytics](https://cris.maastrichtuniversity.nl/en/publications/calibration-the-achilles-heel-of-predictive-analytics)

Used here: Calibration level and slope are reported beside ranking, never instead of it.

> “… the C-index only measures a model’s discriminative ability and does not assess other important aspects …”
>
> Lillelund, Qi, Greiner and Pedersen, arXiv preprint, 2025. [Stop Chasing the C-index: This Is How We Should Evaluate Our Survival Models](https://arxiv.org/html/2506.02075v1)

Used here: Ranking is reported together with calibration, censoring-weighted Brier skill and decision curves.

> “At external validation, some miscalibration between the predicted and observed values should be anticipated.”
>
> Riley, Archer, Snell and colleagues, BMJ, 2024. [Evaluation of clinical prediction models (part 2): how to undertake an external validation study](https://research.birmingham.ac.uk/files/220429945/bmj-2023-074820.full.pdf)

Used here: Observed over expected deaths is checked at every site, and a shift is treated as the expected case.

> “Calibration in the small must be assessed (from the external validation data set) and provided.”
>
> Kattan and colleagues for the AJCC Precision Medicine Core, 2016. [American Joint Committee on Cancer acceptance criteria for inclusion of risk models for individualized prognosis in the practice of precision medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC4955656)

Used here: Reported for each held-out site and for any hospital file.

> “When the incidence of the outcome is different, all predicted risks may be systematically over- or underestimated. … Hence, the intercept of the model can be adjusted (updating).”
>
> Janssen, Vergouwe, Kalkman, Grobbee and Moons, Canadian Journal of Anesthesia, 2009. [A simple method to adjust clinical prediction models to local circumstances](https://link.springer.com/doi/10.1007/s12630-009-9041-x)

Used here: The local factor rescales the baseline hazard, the survival counterpart of adjusting the intercept.

> “… there is less information on methods to assess the calibration of models for time-to-event outcomes.”
>
> Austin, Harrell and van Klaveren, Statistics in Medicine, 2020. [Graphical calibration curves and the integrated calibration index (ICI) for survival models](https://repub.eur.nl/pub/129441/Repub_129441_O-A.pdf)

Used here: Calibration slope and the integrated calibration index are computed with censoring in mind.

### Checking a model where it will be used

> “We call estimating how well a model performs within the intended population/setting ‘targeted validation’.”
>
> Sperrin, Riley, Collins and Martin, Diagnostic and Prognostic Research, 2022. [Targeted validation: validating clinical prediction models in their intended population and setting](https://doaj.org/article/8b8c09d530bf49d99c760f4aca5613dc)

Used here: The Hospital page runs the checks on a hospital’s own file, in the browser, with nothing uploaded.

> “We propose to quantify the degree of relatedness between development and validation samples …”
>
> Debray, Vergouwe, Koffijberg, Nieboer, Steyerberg and Moons, Journal of Clinical Epidemiology, 2015. [A new framework to enhance the interpretation of external validation studies of clinical prediction models](https://pure.eur.nl/en/publications/a-new-framework-to-enhance-the-interpretation-of-external-validat/)

Used here: The Hospital page prints the case mix of the file next to every result.

> “The model should be validated over a time frame and practice setting that is relevant to contemporary patients with disease.”
>
> Kattan and colleagues for the AJCC Precision Medicine Core, 2016. [American Joint Committee on Cancer acceptance criteria for inclusion of risk models for individualized prognosis in the practice of precision medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC4955656)

Used here: Not met by the public cohorts, which are older. This is stated as a limit, and the Hospital page is the route to closing it.

> “A prognostic model should not enter clinical practice unless it has been demonstrated that it performs a useful role.”
>
> Royston and Altman, BMC Medical Research Methodology, 2013. [External validation of a Cox prognostic model: principles and methods](https://ora.ox.ac.uk/objects/uuid:add14c28-8561-45a9-9cc7-4b00258b0929)

Used here: Why each estimate carries an evidence check, and why the site is marked research use only.

### Censored patients

> “… the commonly used C-statistics may depend on the study-specific censoring distribution. … The new procedure consistently estimates a conventional concordance measure which is free of censoring.”
>
> Uno, Cai, Pencina, D’Agostino and Wei, Statistics in Medicine, 2011. [On the C-statistics for evaluating overall adequacy of risk prediction procedures with censored survival data](https://pmc.ncbi.nlm.nih.gov/articles/PMC3079915)

Used here: Ranking is scored with Uno’s C, so a cohort’s follow-up length does not change the answer.

> “… the true outcome event status is unknown for the censored individuals”
>
> Riley, Archer, Snell and colleagues, BMJ, 2024. [Evaluation of clinical prediction models (part 2): how to undertake an external validation study](https://research.birmingham.ac.uk/files/220429945/bmj-2023-074820.full.pdf)

Used here: The reason the label audit exists: a censored patient is not a survivor.

### Showing uncertainty

> “Therefore, visualising, quantifying and reporting the instability in individual-level predictions is essential …”
>
> Riley, Pate, Dhiman, Archer, Martin and Collins, BMC Medicine, 2023. [Clinical prediction models and the multiverse of madness](https://research.birmingham.ac.uk/files/216975841/s12916-023-03212-y.pdf)

Used here: The stability and precision lights of the evidence passport, which can withhold an estimate.

### Breast cancer: the same exercise on an established tool

> “In particular, calibration was relatively poor for younger women (35–49, 50–64 years) and relatively good for older women.”
>
> Gray, Marti, Brewster, Wyatt and Hall, British Journal of Cancer, 2018. [Independent validation of the PREDICT breast cancer prognosis prediction tool in 45,789 patients using Scottish Cancer Registry data](https://pmc.ncbi.nlm.nih.gov/articles/PMC6189179)

Used here: Calibration differing by subgroup is why estimates here carry per-profile checks.

> “Validation results suggest that the PREDICT tool remains essentially relevant for contemporary patients with early stage breast cancer.”
>
> Gray, Marti, Brewster, Wyatt and Hall, British Journal of Cancer, 2018. [Independent validation of the PREDICT breast cancer prognosis prediction tool in 45,789 patients using Scottish Cancer Registry data](https://eprints.soton.ac.uk/426909)

Used here: Re-checking a breast cancer tool in a new population is routine. This project makes the check repeatable.

### Usefulness for decisions, and reporting

> “Diagnostic and prognostic models are typically evaluated with measures of accuracy that do not address clinical consequences.”
>
> Vickers and Elkin, Medical Decision Making, 2006. [Decision curve analysis: a novel method for evaluating prediction models](https://pubmed.ncbi.nlm.nih.gov/17099194/)

Used here: Survival decision curves on the Evidence page.

> “… examination of risk of bias and applicability to the intended population and setting”
>
> Moons, Wolff, Riley and colleagues, Annals of Internal Medicine, 2019. [PROBAST: A tool to assess risk of bias and applicability of prediction model studies: Explanation and elaboration](https://research-information.bris.ac.uk/en/publications/probast-a-tool-to-assess-risk-of-bias-and-applicability-of-predic/)

Used here: docs/TRIPOD_PROBAST.md maps each reporting and appraisal item to where it is addressed.

## Getting a clinical or methodological read without messaging anyone

All of these are public and asynchronous.

1. **A public issue on the repository.** Anyone with a GitHub account can use the *Clinical or statistical review* form: <https://github.com/PRITIDIPADAS/gdc_lens/issues/new/choose>. It asks which page was read and what looked wrong, missing or unclear.
2. **A thread on Datamethods**, a public discussion site for biostatistics and clinical prediction models run by Frank Harrell (<https://discourse.datamethods.org/>, described at <https://fharrell.com/post/disc/>). A ready-to-paste post is below. Ask a methods question, not for an endorsement.
3. **A question on Cross Validated** (<https://stats.stackexchange.com/>) for a single technical point, such as how the local factor interval is built.
4. **The reviewer checklist below**, sent with the site address to whoever supervises the project. It is written so that a clinician can finish it in ten minutes without reading the code.
5. **A preprint** of the write-up on bioRxiv or medRxiv, which makes the work citable and open to public comment.

### Questions worth asking

1. Is leave-one-site-out across six sites an acceptable stand-in for validation at a new hospital, given that all sites are academic cohorts?
2. Is one multiplicative factor on the baseline hazard (observed over expected deaths) a reasonable local correction when a hospital has 100 to 400 patients and few deaths by 3 years?
3. Is an evidence check that withholds an estimate when similar training patients are few, or the estimate is unstable across sites, the right design? The held-out test found it describes how much evidence exists, not where the model is wrong (hypothesis 4 not supported). How should that be communicated?
4. Which predictors would you insist on before this could be taken seriously clinically (grade, Ki-67, treatment, genomic scores)?
5. Is overall survival from diagnosis an acceptable endpoint for a first evaluation, or would you require breast-cancer-specific survival?

### Ready-to-paste post for Datamethods

> **Title:** Leave-one-site-out validation, a one-number local recalibration and an abstain rule for a breast cancer Cox model: what would you check?
>
> I built a small open-source evaluation of a Cox model (age, pT, pN, ER, PR, HER2) on TCGA-BRCA from the NCI Genomic Data Commons and five METABRIC cohorts, 2,811 patients. Each of the six sites is held out in turn. Ranking transports (pooled Uno C 0.69, prediction interval 0.62 to 0.76). The level of risk does not: observed over expected deaths at 3 years pools to 1.03 but the prediction interval is 0.40 to 2.66 (I-squared 81%). A one-number local factor helped in two of six sites and hurt in four where the model was already close. A per-profile evidence check did not predict where calibration failed. Censored patients are never treated as survivors; a label audit shows what that shortcut does to 3-year mortality in short follow-up data.
>
> Everything runs in the browser, including a hospital page where a CSV never leaves the tab. Code, analysis plan written before the cross-site results, and a log of deviations: <https://github.com/PRITIDIPADAS/gdc_lens>. Research use only.
>
> Questions: (1) is leave-one-site-out across academic cohorts a fair stand-in for a new hospital? (2) is a single scalar on the baseline hazard sensible with 100 to 400 local patients? (3) how should an abstain rule that describes evidence, not accuracy, be presented? (4) what is the first thing you would change?

### Ten-minute reviewer checklist

1. **Predict.** Enter a patient you know. Is the 3-year estimate plausible? Does the verdict (show, show with caution, estimate withheld) match how typical the patient is?
2. **Evidence.** Look at the held-out sites. Would you accept this as a stand-in for a hospital the model has not seen? What is missing?
3. **Label audit.** Is it right that a patient with under 3 years of follow-up who is alive cannot be labelled a survivor at 3 years?
4. **Hospital.** Load the example file. Are the wording and the suggested correction clear to someone who is not a statistician?
5. **Methods and limits.** Which limitation matters most to you? Which one is missing?

Please write down anything that felt wrong, even if you cannot say why. Open an issue or reply on the thread.

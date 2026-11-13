// Writes docs/EXPERT_SUPPORT.md from web/src/lib/guidance.js, so the site and the document quote the same words.
//   node scripts/make_expert_support.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { GUIDANCE } = await import(pathToFileURL(path.join(root, 'web', 'src', 'lib', 'guidance.js')).href);

const groups = [...new Set(GUIDANCE.map(g => g.group))];
const quotes = groups.map(name => [`### ${name}`, '',
  ...GUIDANCE.filter(g => g.group === name).flatMap(g => [`> “${g.quote}”`, '>', `> ${g.who}. [${g.title}](${g.url})`, '', `Used here: ${g.use}`, ''])].join('\n')).join('\n');

const text = `# Published support for this kind of evaluation

Methodologists and clinical bodies have written about the practices GDC Lens is built on: testing a prognostic model on sites it has not seen, reporting calibration beside ranking, correcting the level of risk locally, handling censored patients properly, and showing when an estimate should not be trusted. This page collects short quotations with links. The same list appears on the Methods page of the site.

What this page is, and is not:

- These are statements about methods in general. None of the authors has seen or reviewed GDC Lens, and nothing here is an endorsement of it.
- Each quotation was copied from the abstract or text of the page it links to on 11 and 12 November 2026. Quotations are kept short on purpose. Marks of omission (…) show where a sentence continues or where two sentences are joined. Inner quotation marks are shown as single marks.
- The AJCC criteria are criteria for including a model in AJCC-endorsed tools. GDC Lens is a research prototype and does not meet all of them. The item-by-item self-assessment, including what is not met, is in [AJCC_CRITERIA.md](AJCC_CRITERIA.md).

${quotes}
## Getting a clinical or methodological read without messaging anyone

All of these are public and asynchronous.

1. **A public issue on the repository.** Anyone with a GitHub account can use the *Clinical or statistical review* form: <https://github.com/PRITIDIPADAS/gdclens/issues/new/choose>. It asks which page was read and what looked wrong, missing or unclear.
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
> Everything runs in the browser, including a hospital page where a CSV never leaves the tab. Code, analysis plan written before the cross-site results, and a log of deviations: <https://github.com/PRITIDIPADAS/gdclens>. Research use only.
>
> Questions: (1) is leave-one-site-out across academic cohorts a fair stand-in for a new hospital? (2) is a single scalar on the baseline hazard sensible with 100 to 400 local patients? (3) how should an abstain rule that describes evidence, not accuracy, be presented? (4) what is the first thing you would change?

### Ten-minute reviewer checklist

1. **Predict.** Enter a patient you know. Is the 3-year estimate plausible? Does the verdict (show, show with caution, estimate withheld) match how typical the patient is?
2. **Evidence.** Look at the held-out sites. Would you accept this as a stand-in for a hospital the model has not seen? What is missing?
3. **Label audit.** Is it right that a patient with under 3 years of follow-up who is alive cannot be labelled a survivor at 3 years?
4. **Hospital.** Load the example file. Are the wording and the suggested correction clear to someone who is not a statistician?
5. **Methods and limits.** Which limitation matters most to you? Which one is missing?

Please write down anything that felt wrong, even if you cannot say why. Open an issue or reply on the thread.
`;
fs.writeFileSync(path.join(root, 'docs', 'EXPERT_SUPPORT.md'), text);
console.log(`wrote docs/EXPERT_SUPPORT.md (${GUIDANCE.length} quotations, ${text.split('\n').length} lines)`);

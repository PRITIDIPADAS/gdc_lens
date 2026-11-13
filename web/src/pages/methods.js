import { h, clear, fmt, nextFrame } from '../lib/dom.js';
import { loadResults, loadModel, loadGrid } from '../lib/data.js';
import { figure, xy, SERIES } from '../lib/charts.js';
import { table, section, note, scrollable } from '../lib/ui.js';
import { auditGrid, maxRiskDifference, RULE_TEXT } from '../lib/audit.js';
import { GUIDANCE } from '../lib/guidance.js';

const REPO = 'https://github.com/PRITIDIPADAS/gdclens';
const TERM = {
  age: 'Age, linear part', age_nl1: 'Age, spline term 1', age_nl2: 'Age, spline term 2',
  'T>=2': 'pT 2 or higher', 'T>=3': 'pT 3 or 4 (further step)', 'N>=1': 'pN 1 or higher', 'N>=2': 'pN 2 or higher (further step)', 'N>=3': 'pN 3 (further step)',
  ER_neg: 'ER negative (against positive)', ER_unk: 'ER unknown', PR_neg: 'PR negative (against positive)', PR_unk: 'PR unknown', HER2_pos: 'HER2 positive (against negative)', HER2_unk: 'HER2 unknown',
};

const pipeline = () => h('ol', { class: 'steps' }, ...[
  ['Harmonise', 'TCGA-BRCA from the GDC and five METABRIC cohorts from cBioPortal, put on the same definitions.'],
  ['Fit one model', 'A Cox model on age (a smooth curve), pT and pN as steps, and ER, PR and HER2 with an explicit unknown level.'],
  ['Test on a new site', 'Leave one site out, fit on the other five, score the one left out. Six sites give six tests, pooled with a random-effects model.'],
  ['Score with censoring in mind', 'Kaplan-Meier risks, Uno C, censoring-weighted Brier score, calibration level and slope, decision curves. No yes or no labels.'],
  ['Audit every input', 'All 24,624 age, pT, pN and receptor profiles are checked against six rules, such as risk never falling as pN rises.'],
  ['Attach an evidence passport', 'Each profile gets five lights: support, stability, precision, a held-out check and the rule audit. Any red light withholds the estimate.'],
].map(([t, d]) => h('li', {}, h('b', { text: t }), h('span', { class: 'ink2', text: d }))));

function dataSection(res) {
  const cohorts = table(['Site', 'Source', 'Patients', 'Deaths', 'Median follow-up'],
    res.cohorts.map(c => [c.site === 'TCGA' ? 'TCGA-BRCA' : `METABRIC cohort ${c.site.slice(1)}`, c.source, fmt.int(c.n), fmt.int(c.deaths), fmt.months(c.followup_median)]), { caption: 'Analysed patients by site', left: [0, 1] });
  const ex = res.exclusions;
  const flow = table(['Step', 'Patients'], [[ex[0].step.replace('patients in source files', 'In the source files'), fmt.int(ex[0].patients)],
    ...ex.slice(1).map(e => [`Left out: ${e.step}`, fmt.int(e.patients)]), ['Analysed', fmt.int(res.cohorts.reduce((a, c) => a + c.n, 0))]], { caption: 'From the source files to the analysis set', left: [0] });
  return h('div', { class: 'stack' }, h('div', { class: 'cols-2' }, cohorts, flow),
    h('p', { class: 'small ink2', style: { maxWidth: '74ch' }, text: 'The GDC gender field is empty for every TCGA-BRCA case in release 46, so sex is not used and the cohort cannot be checked for sex differences. Race and ancestry are recorded but not used as predictors.' }));
}

function modelSection(res, model) {
  const rows = res.coefficients.map(c => [TERM[c.term] || c.term, fmt.num(c.hr, 2), `${fmt.num(Math.exp(c.beta - 1.96 * c.se), 2)} to ${fmt.num(Math.exp(c.beta + 1.96 * c.se), 2)}`, fmt.num(c.beta, 3), fmt.num(c.se, 3)]);
  const ref = model.ageEffect(model.reference.age);
  const ages = Array.from({ length: 76 }, (_, i) => 20 + i), hr = ages.map(a => Math.exp(model.ageEffect(a) - ref));
  const lo = Math.min(0.5, ...hr) * 0.9, hi = Math.max(8, ...hr) * 1.1;
  const fig = figure({
    title: 'Hazard ratio by age, against age 60',
    caption: 'Other inputs fixed, vertical axis on a log scale. The curve is a restricted cubic spline tabulated at whole years, and from age 45 it never falls (Deviation 1).',
    draw: (host, w) => xy(host, w, {
      height: 280, aria: 'Hazard ratio by age', cross: true,
      x: { domain: [20, 95], ticks: [20, 30, 40, 50, 60, 70, 80, 90], format: v => String(v), label: 'Age at diagnosis (years)' },
      y: { domain: [lo, hi], scale: 'log', ticks: [0.5, 1, 2, 4, 8].filter(t => t >= lo && t <= hi), format: v => fmt.num(v, v < 1 ? 1 : 0), label: 'Hazard ratio', tickWidth: 36 },
      refs: [{ axis: 'y', v: 1, label: 'age 60', left: true }],
      tip: { title: x => `Age ${fmt.num(x, 0)}`, fmtY: v => fmt.num(v, 2) },
      series: [{ name: 'Hazard ratio', color: SERIES[0], pts: ages.map((a, i) => [a, hr[i]]) }],
    }),
    table: () => ({ head: ['Age', 'Hazard ratio'], rows: ages.filter(a => a % 5 === 0).map(a => [String(a), fmt.num(hr[a - 20], 2)]) }),
  });
  return h('div', { class: 'stack' }, h('div', { class: 'cols-2' },
    h('div', { class: 'stack' },
      table(['Term', 'Hazard ratio', '95% interval', 'Coefficient', 'Standard error'], rows, { caption: 'Coefficients of the deployed model', left: [0] }),
      h('p', { class: 'small ink2', text: 'pT and pN use cumulative steps, so each row is the extra hazard ratio for passing that step. Unknown receptors have wide intervals because few patients are unknown.' })),
    fig),
  h('p', { class: 'ink2', style: { maxWidth: '74ch' }, text: `The model was fitted to ${fmt.int(model.n)} patients with ${fmt.int(model.deaths)} deaths. Its baseline hazard is a step function estimated by the Breslow method, so risk at any horizon is 1 minus exp(−H0(t) × exp(linear predictor)).` }));
}

const GLOSSARY = [
  ['Kaplan-Meier risk', 'Observed mortality by a given time, using every patient for as long as they were seen.', 'The reference for the label audit. No yes or no shortcut.'],
  ['Uno C', 'Do patients who die earlier get higher predicted risk?', 'Weighted by the censoring distribution, so it does not depend on how long a cohort was followed.'],
  ['Censoring-weighted Brier score', 'Squared error of predicted 3-year risk.', 'Reported as skill against a Kaplan-Meier null that uses no predictors.'],
  ['Observed over expected', 'Does the average predicted risk match the observed mortality?', 'Calibration in the large with Greenwood standard errors. This is the level of risk.'],
  ['Calibration slope', 'Is the spread of predicted risks right?', 'Separates a shifted level from a wrong spread.'],
  ['Decision curve', 'Net benefit of acting on the model at a given threshold.', 'Compared with acting on everyone or no one, with Kaplan-Meier inside each group.'],
  ['Local factor', 'One number that rescales the risks for a hospital.', 'Observed over expected deaths with an exact interval. Works when follow-up is short.'],
  ['Evidence passport', 'Is there enough evidence behind this profile?', 'Five checks with thresholds fixed in the analysis plan before the results were seen.'],
];

function verifyPanel(res, model) {
  const out = h('div', { class: 'stack', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Re-derive the audit here' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; clear(out);
    out.append(h('p', { class: 'ink2', text: 'Scoring all 24,624 profiles in this tab…' }));
    await nextFrame();
    try {
      const grid = await loadGrid();
      const a = auditGrid(model), diff = maxRiskDifference(a, grid), pub = res.audit.summary;
      const keys = Object.keys(RULE_TEXT);
      const same = keys.every(k => a.summary[k].n_fail === pub[k].n_fail) && a.summary.all_rules_pass === pub.all_rules_pass;
      const rows = [...keys.map(k => [RULE_TEXT[k], fmt.int(a.summary[k].n_fail), fmt.int(pub[k].n_fail)]), ['Profiles passing every rule', fmt.int(a.summary.all_rules_pass), fmt.int(pub.all_rules_pass)]];
      clear(out);
      out.append(note(same ? `Same result as the published audit. The largest difference between the risks computed here and the stored table is ${diff.toExponential(1)}, which is the rounding of the table.` : 'The result differs from the published audit. Please open an issue on the repository.', same ? 'eosin' : 'warn'),
        table(['Rule', 'Profiles failing, computed here', 'Published'], rows, { caption: 'Audit re-derived in this browser', left: [0] }));
    } catch (e) { clear(out); out.append(note(`Could not run the check: ${e.message}`, 'warn')); } finally { btn.disabled = false; }
  });
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, btn), out);
}

function auditSection(res, model) {
  const s = res.audit.summary;
  return h('div', { class: 'stack' },
    h('p', { style: { maxWidth: '74ch' }, text: `Every combination of age (20 to 95), pT, pN and the three receptors, ${fmt.int(s.profiles)} in all, was scored and checked against six rules. ${fmt.int(s.all_rules_pass)} profiles pass every rule. The ${fmt.int(s.hr.n_fail)} that do not are all rare extremes whose hazard ratio against the reference profile is beyond 50 or below 1 in 50; their estimates are shown with a warning.` }),
    table(['Rule', 'Profiles failing'], Object.keys(RULE_TEXT).map(k => [RULE_TEXT[k], fmt.int(s[k].n_fail)]), { caption: 'Audit rules and failures', left: [0] }),
    h('p', { class: 'small ink2', style: { maxWidth: '74ch' }, text: 'The advisory rule fails for many profiles because the unknown-receptor level has its own coefficient, estimated from few patients. It is shown on the Predict page, not enforced.' }),
    h('h3', { text: 'Check it yourself' }),
    h('p', { class: 'ink2', style: { maxWidth: '74ch' }, text: 'The coefficients and baseline hazard ship with this page. The button below scores every profile from them and compares the audit with the one produced by the Python code.' }),
    verifyPanel(res, model));
}

const LIMITS = [
  ['Research use only.', 'This is not a medical device. It has not been validated prospectively and is not for decisions about individual patients.'],
  ['Follow-up in TCGA is short.', 'The median is about 30 months, so 5 and 10 year numbers rest on few patients. The evidence passport reflects this.'],
  ['The model is small on purpose.', 'It uses age, pT, pN and three receptors. It has no grade, no treatment and no genomic data.'],
  ['Receptors can be unknown.', 'The model has a separate unknown level for each receptor, so those estimates are wide.'],
  ['The audit checks behaviour, not truth.', 'It shows that outputs are bounded and move in the right direction, not that they are right.'],
  ['Passport verdicts did not locate calibration failures.', 'A permutation test found no link between a profile\'s verdict and whether the model was calibrated for it at a held-out site (H4 not supported).'],
  ['The label audit assumes uninformative censoring.', 'The simulations use Weibull survival and uniform administrative censoring. Censoring related to prognosis would add bias that is not measured here.'],
  ['Time zero is diagnosis, but stage is known after surgery.', 'pT and pN come from the surgical specimen. Survival is counted from diagnosis, so anyone who died before surgery is absent and very early risk is slightly understated.'],
  ['The endpoint is death from any cause.', 'Cause of death is not used, so deaths unrelated to breast cancer count as events, more so at older ages.'],
  ['The cohorts are not recent.', 'The public data cover older treatment eras, so they say little about how the model performs for patients treated today. The Hospital page is the route to checking that locally.'],
];

const DEVIATIONS = [
  ['1', 'Age effect made monotone from age 45', 'Yes'], ['2', 'Minimum set size for the reassurance rule raised from 100 to 250', 'Yes'], ['3', 'Passport bootstrap: 100 refits in validation, 300 in the shipped table', 'No, compute budget'],
  ['4', 'Exploratory analyses added or dropped', 'Partly'], ['5', 'Sensitivity grid for the rule threshold (7.5% and 10%)', 'Yes'],
];

function guidanceSection() {
  if (!GUIDANCE.length) return null;
  const groups = [...new Set(GUIDANCE.map(g => g.group))];
  const quote = g => h('blockquote', { class: 'quote' },
    h('p', { text: `“${g.quote}”` }),
    h('footer', {}, g.who, ': ', h('a', { href: g.url, rel: 'noopener', target: '_blank', text: g.title })),
    g.use ? h('p', { class: 'small ink2 use', text: `Used here: ${g.use}` }) : null);
  return section('guidance', 'What others have written about this kind of evaluation',
    'Short quotations from published statements by methodologists and clinical bodies about the practices used here. They describe the methods, not this project, and none of the authors has reviewed it.',
    h('div', { class: 'stack', style: { gap: '32px' } }, ...groups.map(name => h('div', { class: 'stack' }, h('h3', { text: name }), ...GUIDANCE.filter(g => g.group === name).map(quote)))),
    h('p', { class: 'small ink2', text: 'The full list, with how to ask for a clinical review without messaging anyone directly, is in docs/EXPERT_SUPPORT.md in the repository.' }));
}

export async function render(root) {
  const [res, model] = await Promise.all([loadResults(), loadModel()]);
  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('h1', { text: 'Methods and limits' }),
      h('p', { class: 'lede', text: 'What was built, on which data, how it was checked, and where it stops being trustworthy. Every number on the other pages comes from the results folder of the repository, written by one script.' })),
    section('pipeline', 'The pipeline', null, pipeline()),
    section('data', 'Data', null, dataSection(res)),
    section('model', 'The model', null, modelSection(res, model)),
    section('metrics', 'The measures', 'Each one answers a different question, and none of them needs a yes or no label.', table(['Measure', 'What it asks', 'Why this one'], GLOSSARY, { caption: 'Measures used', left: [0, 1, 2] })),
    section('audit', 'The audit', null, auditSection(res, model)),
    section('limits', 'Limits and intended use', null, h('ul', { class: 'limits' }, ...LIMITS.map(([a, b]) => h('li', {}, h('b', { text: `${a} ` }), b)))),
    section('deviations', 'Deviations from the analysis plan', 'The analysis plan was written before the results were seen. Every change is logged with whether it was decided afterwards, and none removes a result.',
      table(['#', 'Change', 'Decided after seeing results?'], DEVIATIONS, { caption: 'Deviations', left: [1, 2] }),
      h('p', { class: 'small' }, 'Details: ', h('a', { href: `${REPO}/blob/main/docs/DEVIATIONS.md`, rel: 'noopener', target: '_blank', text: 'docs/DEVIATIONS.md' }), ' and ', h('a', { href: `${REPO}/blob/main/docs/ANALYSIS_PLAN.md`, rel: 'noopener', target: '_blank', text: 'docs/ANALYSIS_PLAN.md' }), '.')),
    guidanceSection(),
    section('reproduce', 'Reproduce everything', null, h('div', { class: 'stack' },
      scrollable(h('pre', {}, h('code', { text: `git clone ${REPO}\ncd gdclens\npip install -e ".[dev]"\npython scripts/fetch_data.py   # GDC and cBioPortal tables\npython scripts/run_all.py      # all analyses, writes results/\npython scripts/export_web.py   # writes the data the site loads\ncd web && npm ci && npm test && npm run build` })), 'Commands to reproduce everything'),
      h('p', { class: 'small ink2', text: 'Seeds are fixed. The Python and the browser code are checked against each other by the test suite.' })))));
}

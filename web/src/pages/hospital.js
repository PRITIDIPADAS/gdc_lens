import { h, clear, fmt, download } from '../lib/dom.js';
import { loadResults, loadModel, loadGrid, demoUrl } from '../lib/data.js';
import { figure, forest, xy, SERIES } from '../lib/charts.js';
import { table, section, note } from '../lib/ui.js';
import { gridIndex } from '../lib/model.js';
import { unoCFast } from '../lib/stats.js';
import { parseCsv, readPatients, analyse, ruleCheck, ruleStatus, bootstrapUno, deathsNeeded, kappaHalfWidth, verdictCounts, FIELD_LABEL } from '../lib/hospital.js';

const SITE_NAME = { TCGA: 'TCGA-BRCA (GDC)', M1: 'METABRIC cohort 1', M2: 'METABRIC cohort 2', M3: 'METABRIC cohort 3', M4: 'METABRIC cohort 4', M5: 'METABRIC cohort 5' };
const TEMPLATE = 'age,T,N,ER,PR,HER2,time_months,event\n58,1,0,pos,pos,neg,61.2,0\n47,2,1,neg,neg,pos,34.0,1\n71,2,0,pos,unk,unk,18.5,0\n';
const MAX_BYTES = 40e6;
const MIX = [['age_median', 'Median age (years)', v => fmt.num(v, 0)], ['er_pos', 'ER positive', v => fmt.pct(v, 0)], ['her2_pos', 'HER2 positive', v => fmt.pct(v, 0)], ['t1', 'pT1', v => fmt.pct(v, 0)], ['n0', 'pN0', v => fmt.pct(v, 0)]];
const VERDICT_NOTE = { SHOW: 'All five evidence checks pass', 'SHOW WITH CAUTION': 'No check fails and at least one is borderline', ABSTAIN: 'At least one check fails, so the Predict page withholds the estimate' };
const ok = Number.isFinite;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// ---------- the file panel ----------
function formatPanel() {
  const rows = [
    ['age', 'Years. A column in days is converted.', '58'],
    ['T', 'pT category: 1, 2, 3 or T1c, T2, T4b. T3 and T4 are merged.', '2'],
    ['N', 'pN category: 0 to 3, or N0, N1mi, N2a.', '1'],
    ['ER, PR, HER2', 'pos or neg. Blank, unknown or equivocal counts as unknown.', 'pos'],
    ['time_months', 'Months from diagnosis to death or last contact. Days or years are converted.', '34.5'],
    ['event', '1 if the patient died, 0 if alive at last contact.', '0'],
  ];
  return h('div', { class: 'panel stack' },
    h('h3', { text: 'File format' }),
    h('p', { class: 'ink2', text: 'One row per patient, with a header row. Column names are matched loosely, so age_at_diagnosis, pT, OS_MONTHS and vital_status are recognised.' }),
    table(['Column', 'Values', 'Example'], rows, { caption: 'Expected columns', left: [1] }),
    h('p', { class: 'small ink2', text: 'Use de-identified data. The model needs no names, record numbers or dates.' }),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Download a template', onclick: () => download('gdc_lens_template.csv', TEMPLATE, 'text/csv;charset=utf-8') })));
}

function readingReport(name, rep) {
  const mapping = rep.mapping.map(m => h('li', {}, `${FIELD_LABEL[m.field]} from `, h('b', { text: m.column })));
  return h('div', { class: 'panel stack' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', { text: name }), h('span', { class: 'badge', text: `${fmt.int(rep.used)} of ${fmt.int(rep.read)} rows used` })),
    rep.error ? h('p', { class: 'err', text: rep.error }) : null,
    ...rep.notes.map(t => note(t)),
    rep.excluded.length ? table(['Left out', 'Rows'], rep.excluded.map(e => [e.step, fmt.int(e.patients)]), { caption: 'Rows left out', left: [0] }) : null,
    h('details', { class: 'adv' }, h('summary', { text: 'Columns recognised' }), h('div', {}, h('ul', { style: { margin: 0, paddingLeft: '18px' } }, mapping),
      rep.ignored.length ? h('p', { class: 'small ink2', text: `Not used: ${rep.ignored.join(', ')}.` }) : null)));
}

// ---------- sections ----------
function tiles(A, rep) {
  const t = (label, value, sub) => h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: value }), sub ? h('small', { text: sub }) : null);
  const k = A.km[36];
  return h('div', { class: 'metric-grid' },
    t('Patients used', fmt.int(A.n), `of ${fmt.int(rep.read)} rows`),
    t('Deaths', fmt.int(A.deaths), `${fmt.pct(A.deaths / A.n, 0)} of patients`),
    t('Median follow-up', ok(A.followup) ? fmt.months(A.followup) : 'not reached', 'reverse Kaplan-Meier'),
    t('3-year mortality', fmt.pct(k.est, 1), `95% interval ${fmt.pct(k.lo, 1)} to ${fmt.pct(k.hi, 1)}`),
    t('Model, average 3-year risk', fmt.pct(A.meanPred[36], 1), 'as published'),
    t('Status known at 3 years', fmt.pct(A.known36, 0), 'died, or followed past 3 years'));
}

function warnings(A) {
  const w = [];
  if (!A.ok[36]) w.push('Follow-up is too short to judge 3-year risk: fewer than 10% of patients are still under observation at 3 years, or fewer than 30 patients have a known 3-year status, or there are fewer than 5 deaths by 3 years. Calibration and the safe-to-reassure check are skipped. The local factor below still uses every patient for as long as they were seen.');
  if (A.n < 300 || A.deaths < 50) w.push('This is a small sample, so every interval on this page is wide. Treat the results as a first look.');
  return w.map(t => note(t, 'warn'));
}

function mixTable(res, A) {
  const rows = MIX.map(([k, label, f]) => {
    const vals = res.cohorts.map(c => c[k]), lo = Math.min(...vals), hi = Math.max(...vals), v = A.mix[k];
    return [label, f(v), `${f(lo)} to ${f(hi)}`, v < lo ? 'below range' : v > hi ? 'above range' : 'within range'];
  });
  return table(['', 'Your patients', 'Six sites', 'Position'], rows, { caption: 'Case mix against the six training sites' });
}

function verdictTable(vc) {
  return table(['Evidence behind each patient\'s profile', 'Patients', 'Share'], vc.map(v => [`${v.label.charAt(0)}${v.label.slice(1).toLowerCase()}: ${VERDICT_NOTE[v.label]}`, fmt.int(v.n), fmt.pct(v.share, 0)]), { caption: 'Evidence verdicts of the profiles in your file', left: [0] });
}

function rankingFigure(res, A) {
  const sm = res.site_metrics.filter(r => r.model === 'clinical' && r.horizon === 36);
  const rows = res.sites.map(s => { const r = sm.find(x => x.site === s); return { label: SITE_NAME[s], est: r.uno_c, lo: r.uno_c - 1.96 * r.uno_c_se, hi: r.uno_c + 1.96 * r.uno_c_se }; });
  const p = res.pooled_metrics.find(r => r.model === 'clinical' && r.horizon === 36 && r.metric === 'uno_c');
  rows.push({ kind: 'pooled', label: 'Held-out sites, pooled', est: p.est, lo: p.lo, hi: p.hi, pi: [p.pi_lo, p.pi_hi] });
  rows.push({ kind: 'gap' });
  const c = A.c.est, lo = c - 1.96 * A.c.sd, hi = c + 1.96 * A.c.sd;
  rows.push({ label: 'Your hospital', est: c, lo, hi, color: SERIES[0] });
  const where = c < p.pi_lo ? 'below' : c > p.pi_hi ? 'above' : 'inside';
  const dom = [Math.min(0.5, lo - 0.02), Math.max(0.85, hi + 0.02)];
  return figure({
    title: 'Uno C: your hospital next to the six held-out sites',
    caption: `Concordance with censoring weights, truncated at ${fmt.num(A.tau, 0)} months, where censoring leaves enough patients under observation. Your interval is a bootstrap with 200 resamples. Your C of ${fmt.num(c, 2)} is ${where} the 95% prediction interval for a new site (${fmt.num(p.pi_lo, 2)} to ${fmt.num(p.pi_hi, 2)}). A value of 0.5 is chance.`,
    draw: (host, w) => forest(host, w, { rows, xdomain: dom, ref: 0.5, refLabel: 'chance', xlabel: 'Uno C', fmtEst: v => fmt.num(v, 2), labelWidth: 170, rightWidth: 150, aria: 'Uno C of your hospital and the held-out sites' }),
    table: () => ({ head: ['Group', 'Uno C', '95% interval'], rows: rows.filter(r => r.est != null).map(r => [r.label, fmt.num(r.est, 3), `${fmt.num(r.lo, 3)} to ${fmt.num(r.hi, 3)}`]) }),
  });
}

function calibrationFigure(A) {
  const mx = Math.max(0.1, Math.ceil(Math.max(...A.bins.flatMap(b => [b.pred, b.hi])) * 20) / 20);
  return figure({
    title: 'Predicted against observed 3-year mortality in your patients',
    legend: [{ name: 'Risk group (equal numbers of patients, lowest to highest predicted risk)', color: SERIES[0] }],
    caption: 'Each dot groups your patients by predicted risk. The vertical line is the 95% interval of the Kaplan-Meier observed risk. Points on the diagonal are perfectly calibrated; points below it mean the model predicted more deaths than occurred.',
    draw: (host, w) => xy(host, w, {
      height: Math.min(380, Math.round(w * 0.8)), aria: 'Calibration of the model in your patients', diag: [0, mx],
      x: { domain: [0, mx], format: v => fmt.pct(v), label: 'Predicted' }, y: { domain: [0, mx], format: v => fmt.pct(v), tickWidth: 40, label: 'Observed' },
      tip: { title: x => `Predicted ${fmt.pct(x, 1)}`, fmtY: v => fmt.pct(v, 1) },
      series: [{ name: 'Observed', color: SERIES[0], kind: 'points', pts: A.bins.map(b => [b.pred, b.obs]), whisk: A.bins.map(b => [b.lo, b.hi]), extra: A.bins.map(b => [{ value: `${fmt.int(b.n)} patients, ${fmt.int(b.deaths)} deaths`, name: '' }]) }],
    }),
    table: () => ({ head: ['Group', 'Patients', 'Predicted', 'Observed', '95% interval'], rows: A.bins.map((b, i) => [`Group ${i + 1}`, fmt.int(b.n), fmt.pct(b.pred, 1), fmt.pct(b.obs, 1), `${fmt.pct(b.lo, 1)} to ${fmt.pct(b.hi, 1)}`]) }),
  });
}

function levelPanel(res, A) {
  const k = A.kappa, c = A.cal[36];
  const sm = res.site_metrics.filter(r => r.model === 'clinical' && r.horizon === 36).map(r => r.oe);
  const hw = kappaHalfWidth(k.observed);
  const meaning = k.lo > 1 ? 'The interval is above 1: the model predicted fewer deaths than occurred, so your patients do worse than the training average.'
    : k.hi < 1 ? 'The interval is below 1: the model predicted more deaths than occurred, so your patients do better than the training average.'
      : 'The interval includes 1: there is no clear difference from the training average, and the model can be used as published.';
  const advice = A.applies ? 'In the held-out sites, applying a factor whose interval excluded 1 reduced the error. Applying it when the interval included 1 only added noise.' : 'In the held-out sites, leaving the model alone when the interval included 1 was the safer choice.';
  const per = k.observed / A.n;
  const need = [0.3, 0.2, 0.1].map(w => { const d = deathsNeeded(w); return [`±${Math.round(w * 100)}%`, fmt.int(d), fmt.int(Math.ceil(d / per))]; });
  return h('div', { class: 'panel stack' },
    h('h3', { text: 'Observed against expected' }),
    c ? h('dl', { class: 'kv' },
      h('dt', { text: 'Observed 3-year mortality' }), h('dd', { text: `${fmt.pct(A.km[36].est, 1)}  (${fmt.pct(A.km[36].lo, 1)} to ${fmt.pct(A.km[36].hi, 1)})` }),
      h('dt', { text: 'Model, average prediction' }), h('dd', { text: fmt.pct(c.exp, 1) }),
      h('dt', { text: 'Observed / expected' }), h('dd', { text: `${fmt.num(c.oe, 2)}  (${fmt.num(c.lo, 2)} to ${fmt.num(c.hi, 2)})` }),
      h('dt', { text: 'The six held-out sites' }), h('dd', { text: `${fmt.num(Math.min(...sm), 2)} to ${fmt.num(Math.max(...sm), 2)}` }))
      : h('p', { class: 'ink2', text: 'Not available with this follow-up.' }),
    h('h3', { text: 'Local factor' }),
    h('p', {}, h('b', { text: `κ = ${fmt.num(k.kappa, 2)}` }), `  (95% interval ${fmt.num(k.lo, 2)} to ${fmt.num(k.hi, 2)}) from ${fmt.int(k.observed)} observed and ${fmt.int(k.expected)} expected deaths in the first 3 years.`),
    h('p', { class: 'ink2', text: meaning }),
    h('p', { class: 'ink2', text: advice }),
    h('p', { class: 'small ink2', text: 'The factor compares deaths with the deaths the model expects over each patient\'s own follow-up, so it works when follow-up is short.' }),
    h('h3', { text: 'How many deaths does the factor need?' }),
    h('p', { class: 'ink2', text: `Yours rests on ${fmt.int(k.observed)} deaths, so its interval is about ±${fmt.num(hw * 100, 0)}%.` }),
    table(['Precision', 'Deaths', 'Patients at your death rate'], need, { caption: 'Deaths needed for a given precision of the local factor' }));
}

function correctionTable(A) {
  const row = (label, c) => [label, fmt.pct(c.exp, 1), fmt.pct(c.obs, 1), `${fmt.num(c.oe, 2)} (${fmt.num(c.lo, 2)} to ${fmt.num(c.hi, 2)})`, fmt.pts(c.diff, 1)];
  return table(['', 'Average predicted', 'Observed', 'Observed / expected', 'Predicted minus observed'], [row('Model as published', A.cal[36]), row('With the local factor, cross-fitted', A.cv.cal)], { caption: 'Calibration at 3 years before and after the local factor' });
}

function ruleRows(res, A) {
  const out = [];
  for (const a of ['0.05', '0.075', '0.1']) {
    const lam = res.rule_final[a].lam, alpha = +a;
    const cells = (label, r) => [`${fmt.pct(alpha, alpha === 0.075 ? 1 : 0)}`, fmt.pct(lam, 1), label, `${fmt.int(r.n)} (${fmt.pct(r.share, 0)})`, r.n >= 5 ? `${fmt.pct(r.est, 1)} (${fmt.pct(r.lo, 1)} to ${fmt.pct(r.hi, 1)})` : 'n/a', r.n >= 5 ? fmt.pct(r.upper, 1) : 'n/a', ruleStatus(r, alpha)];
    out.push({ a, lam, base: ruleCheck(A.risk[36], A.time, A.event, lam), local: A.cv ? ruleCheck(A.cv.risk[36], A.time, A.event, lam) : null, cells });
  }
  return out;
}

function ruleTable(rr) {
  const rows = rr.flatMap(r => [r.cells('Model as published', r.base), ...(r.local ? [r.cells('With the local factor', r.local)] : [])]);
  return table(['Target', 'Threshold', 'Version', 'Reassured', 'Observed 3-year mortality', 'Upper 95% bound', 'Result'], rows, { caption: 'Safe-to-reassure rule applied to your patients', left: [2, 6] });
}

// ---------- downloads ----------
function reportText(name, rep, A, res, model, vc, rr, mixRows) {
  const L = [];
  const k = A.kappa, c = A.cal[36];
  L.push('# GDC Lens: local check of a breast-cancer survival model', '', 'Research use only. Not a medical device. Not for decisions about individual patients.', '');
  L.push(`Date: ${new Date().toISOString().slice(0, 10)}`, `File: ${name}`, `Model: clinical Cox model, version ${model.version}, built from ${fmt.int(model.n)} patients (${fmt.int(model.deaths)} deaths) at six sites`, '');
  L.push('## Data', `- Rows read: ${fmt.int(rep.read)}; patients used: ${fmt.int(rep.used)}`);
  rep.excluded.forEach(e => L.push(`- Left out, ${e.step}: ${fmt.int(e.patients)}`));
  rep.notes.forEach(t => L.push(`- ${t}`));
  L.push(`- Deaths: ${fmt.int(A.deaths)}; median follow-up: ${ok(A.followup) ? fmt.months(A.followup) : 'not reached'} (reverse Kaplan-Meier)`);
  L.push(`- 3-year mortality, Kaplan-Meier: ${fmt.pct(A.km[36].est, 1)} (95% interval ${fmt.pct(A.km[36].lo, 1)} to ${fmt.pct(A.km[36].hi, 1)})`, '');
  L.push('## Case mix against the six training sites', ...mixRows.map(r => `- ${r[0]}: ${r[1]} (sites ${r[2]}; ${r[3]})`), '');
  L.push('## Ranking', A.c ? `- Uno C: ${fmt.num(A.c.est, 3)} (95% interval ${fmt.num(A.c.est - 1.96 * A.c.sd, 3)} to ${fmt.num(A.c.est + 1.96 * A.c.sd, 3)}), truncated at ${fmt.num(A.tau, 0)} months` : '- Not computed', '');
  L.push('## Level of risk at 3 years');
  if (c) L.push(`- Average predicted: ${fmt.pct(c.exp, 1)}; observed: ${fmt.pct(c.obs, 1)}; observed / expected: ${fmt.num(c.oe, 2)} (${fmt.num(c.lo, 2)} to ${fmt.num(c.hi, 2)})`);
  else L.push('- Follow-up is too short to judge 3-year risk.');
  L.push(`- Local factor (kappa): ${fmt.num(k.kappa, 2)} (95% interval ${fmt.num(k.lo, 2)} to ${fmt.num(k.hi, 2)}) from ${fmt.int(k.observed)} observed and ${fmt.int(k.expected)} expected deaths`);
  L.push(`- Interval excludes 1: ${A.applies ? 'yes, the factor is worth applying' : 'no, use the model as published'}`);
  if (A.cv) L.push(`- With the local factor, cross-fitted: average predicted ${fmt.pct(A.cv.cal.exp, 1)}; observed / expected ${fmt.num(A.cv.cal.oe, 2)} (${fmt.num(A.cv.cal.lo, 2)} to ${fmt.num(A.cv.cal.hi, 2)})`);
  L.push('');
  if (A.bins) L.push('## Calibration groups', ...A.bins.map((b, i) => `- Group ${i + 1}: ${fmt.int(b.n)} patients, predicted ${fmt.pct(b.pred, 1)}, observed ${fmt.pct(b.obs, 1)} (${fmt.pct(b.lo, 1)} to ${fmt.pct(b.hi, 1)})`), '');
  if (A.ok[36]) {
    L.push('## Safe-to-reassure rule');
    rr.forEach(r => [['model as published', r.base], ['with the local factor', r.local]].forEach(([label, x]) => { if (x) L.push(`- Target ${fmt.pct(+r.a, 1)}, threshold ${fmt.pct(r.lam, 1)}, ${label}: ${fmt.int(x.n)} reassured, observed ${x.n >= 5 ? fmt.pct(x.est, 1) : 'n/a'}, ${ruleStatus(x, +r.a)}`); }));
    L.push('');
  }
  if (vc) L.push('## Evidence behind the profiles', ...vc.map(v => `- ${v.label}: ${fmt.int(v.n)} patients (${fmt.pct(v.share, 0)})`), '');
  L.push('Computed in the browser; no patient data left the computer. Methods: see the Methods page and docs/METHODS.md in the repository.');
  return L.join('\n');
}

function predictionsCsv(pts, A, grid, rr) {
  const lam = rr[0].lam;
  const head = ['row', 'age', 'pT', 'pN', 'ER', 'PR', 'HER2', 'time_months', 'event', 'risk_3y', 'risk_5y', 'risk_10y', 'risk_3y_local', 'risk_5y_local', 'risk_10y_local', ...(grid ? ['evidence'] : []), 'reassured_5pct', 'reassured_5pct_local'];
  const f = v => v.toFixed(4);
  const lines = [head.join(',')];
  pts.forEach((p, i) => {
    lines.push([p.row, p.age.toFixed(1), p.T, p.N, p.ER, p.PR, p.HER2, p.time.toFixed(2), p.event, f(A.risk[36][i]), f(A.risk[60][i]), f(A.risk[120][i]), f(A.local[36][i]), f(A.local[60][i]), f(A.local[120][i]),
      ...(grid ? [grid.verdict_labels[grid.verdict[gridIndex(p)]]] : []), A.risk[36][i] <= lam ? 'yes' : 'no', A.local[36][i] <= lam ? 'yes' : 'no'].join(','));
  });
  return lines.join('\n');
}

// ---------- page ----------
export async function render(root) {
  const [res, model] = await Promise.all([loadResults(), loadModel()]);
  const status = h('div', { class: 'stack', 'aria-live': 'polite' });
  const out = h('div', { class: 'stack' });
  const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain', hidden: true, 'aria-label': 'Choose a follow-up file' });
  let token = 0;

  const drop = h('div', { class: 'drop' },
    h('b', { text: 'Drop a CSV file here' }),
    h('span', { class: 'ink2', text: 'or choose one from your computer. It is read in this tab and goes nowhere else.' }),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn primary', type: 'button', text: 'Choose a file', onclick: () => input.click() }),
      h('button', { class: 'btn', type: 'button', text: 'Use the example file', onclick: () => useDemo() })),
    h('span', { class: 'small ink2', text: 'The example is synthetic: 1,500 simulated patients from a hospital that differs from the training sites. It contains no real patient.' }),
    input);
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) readFile(f); });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });

  async function readFile(file) {
    if (file.size > MAX_BYTES) { clear(status); status.append(note('That file is larger than 40 MB. Remove the columns the model does not use and try again.', 'warn')); return; }
    run(await file.text(), file.name);
  }
  async function useDemo() {
    try { const r = await fetch(demoUrl()); if (!r.ok) throw new Error(String(r.status)); run(await r.text(), 'demo_hospital.csv (synthetic)'); } catch (e) { clear(status); status.append(note(`Could not load the example file (${e.message}).`, 'warn')); }
  }
  const remove = () => { token++; clear(status); clear(out); };

  async function run(text, name) {
    const me = ++token;
    clear(status); clear(out);
    const { patients, report } = readPatients(parseCsv(text));
    status.append(readingReport(name, report));
    if (report.error) return;
    if (patients.length < 30) { status.append(note(`Only ${patients.length} usable patients. At least 30 are needed.`, 'warn')); return; }
    const grid = await loadGrid().catch(() => null);
    if (me !== token) return;
    const A = analyse(model, patients);
    A.c = { est: unoCFast(A.time, A.event, A.lp, A.tau), sd: null };
    const vc = grid ? verdictCounts(patients, grid, gridIndex) : null;
    const rr = ruleRows(res, A);

    // ranking placeholder until the bootstrap finishes
    const bar = h('i'), rankHost = h('div', { class: 'stack' }, h('p', { class: 'ink2', text: 'Checking the ranking with 200 bootstrap resamples.' }), h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Bootstrap progress' }, bar));
    const dlReport = h('button', { class: 'btn primary', type: 'button', text: 'Download the report', disabled: true });
    const dlCsv = h('button', { class: 'btn', type: 'button', text: 'Download predictions (CSV)', disabled: true });
    const mixRows = MIX.map(([k, label, f]) => { const vals = res.cohorts.map(c => c[k]), lo = Math.min(...vals), hi = Math.max(...vals), v = A.mix[k]; return [label, f(v), `${f(lo)} to ${f(hi)}`, v < lo ? 'below range' : v > hi ? 'above range' : 'within range']; });
    dlReport.addEventListener('click', () => download('gdc_lens_local_check.md', reportText(name, report, A, res, model, vc, rr, mixRows), 'text/plain;charset=utf-8'));
    dlCsv.addEventListener('click', () => download('gdc_lens_predictions.csv', predictionsCsv(patients, A, grid, rr), 'text/csv;charset=utf-8'));

    out.append(
      section('patients', 'Your patients', 'Who is in the file, how long they were followed, and how they compare with the six sites the model was built from.',
        tiles(A, report), ...warnings(A),
        h('div', { class: 'cols-2' }, mixTable(res, A), vc ? verdictTable(vc) : null)),
      section('ranking', 'Does the ranking hold up?', 'Uno C asks whether patients who died earlier were given higher risks. It does not depend on the level of risk, so it is expected to transport.', rankHost),
      section('level', 'Does the level of risk hold up?', 'Observed over expected deaths at 3 years. This is the part that moved between sites.',
        h('div', { class: 'cols-2' }, A.bins ? calibrationFigure(A) : note('The follow-up in this file does not allow a 3-year calibration plot.', 'warn'), levelPanel(res, A))),
      section('correction', 'After a local correction', 'One number, estimated from your own deaths, rescales the model\'s risks. Each patient is scored with a factor estimated on the other patients only (five folds), so the result is not flattered by fitting and scoring on the same data.',
        A.cv ? correctionTable(A) : note('Cross-fitting needs at least 10 deaths and enough follow-up for a 3-year estimate.', 'warn'),
        A.ok[36] ? h('div', { class: 'stack' }, h('h3', { text: 'Safe-to-reassure rule' }), h('p', { class: 'ink2', style: { maxWidth: '74ch' }, text: 'A patient is reassured when the predicted 3-year risk is at or below the threshold, which was chosen on the six training sites and not on your data. Within target means the upper one-sided 95% bound of the observed mortality among reassured patients is at or below the target.' }), ruleTable(rr)) : null),
      section('export', 'Take the results with you', 'Everything above is computed on this computer. These files are created here and are not sent anywhere.',
        h('div', { class: 'row' }, dlReport, dlCsv, h('button', { class: 'btn', type: 'button', text: 'Print or save as PDF', onclick: () => window.print() }), h('button', { class: 'btn quiet', type: 'button', text: 'Remove the data from this page', onclick: remove })),
        h('p', { class: 'small ink2', style: { maxWidth: '74ch' }, text: 'The predictions file has one row per patient with 3, 5 and 10 year risks as published and with the local factor, the evidence verdict of the profile and whether the rule reassures the patient. The local factor is estimated on all your patients, so check it on new patients before relying on it.' })));

    bootstrapUno(A.time, A.event, A.lp, A.tau, { onProgress: p => { bar.style.width = `${Math.round(p * 100)}%`; } }).then(({ sd }) => {
      if (me !== token) return;
      A.c.sd = sd;
      clear(rankHost);
      rankHost.append(rankingFigure(res, A));
      dlReport.disabled = false; dlCsv.disabled = false;
    });
  }

  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('h1', { text: 'Check the model on your own patients' }),
      h('p', { class: 'lede', text: 'Survival models usually rank patients much the same at a new hospital but can misjudge the level of risk. Load follow-up data from your hospital to see how this model does there and to estimate the one number that corrects it. The file never leaves this browser.' })),
    section('data', 'Your data', null, h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, drop, status), formatPanel())),
    out));
}

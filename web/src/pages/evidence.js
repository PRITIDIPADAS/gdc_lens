import { h, clear, fmt, tidy } from '../lib/dom.js';
import { loadResults } from '../lib/data.js';
import { figure, forest, xy, SERIES, niceTicks } from '../lib/charts.js';
import { statusMark, table, section } from '../lib/ui.js';

const SITES = ['TCGA', 'M1', 'M2', 'M3', 'M4', 'M5'];
const SITE_NAME = { TCGA: 'TCGA-BRCA (GDC)', M1: 'METABRIC cohort 1', M2: 'METABRIC cohort 2', M3: 'METABRIC cohort 3', M4: 'METABRIC cohort 4', M5: 'METABRIC cohort 5' };
const MODELS = ['clinical', 'age_stage', 'stage', 'rsf', 'gbsa'];
const MODEL_NAME = { clinical: 'Deployed (age, pT, pN, ER, PR, HER2)', age_stage: 'Age and stage group', stage: 'Stage group', rsf: 'Random survival forest', gbsa: 'Gradient-boosted Cox' };
const MODEL_SHORT = { clinical: 'Deployed', age_stage: 'Age + stage', stage: 'Stage', rsf: 'Survival forest', gbsa: 'Boosted Cox' };
const MODEL_COLOR = { clinical: SERIES[0], age_stage: SERIES[1], stage: SERIES[2], rsf: SERIES[3], gbsa: SERIES[4] };

const domainOf = (rows, include = [], pad = 0.06) => {
  const v = rows.flatMap(r => [r.lo, r.hi, r.est, ...(r.pi || [])]).concat(include).filter(Number.isFinite);
  const lo = Math.min(...v), hi = Math.max(...v), d = (hi - lo) * pad;
  return [lo - d, hi + d];
};

// Draw a responsive grid of small panels inside one figure frame.
function panels(host, w, items, drawPanel, minW = 250) {
  const gap = 16, cols = Math.max(1, Math.floor((w + gap) / (minW + gap))), pw = Math.floor((w - gap * (cols - 1)) / cols);
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, ${pw}px)`, gap: `18px ${gap}px` } });
  items.forEach(it => {
    const body = h('div');
    grid.append(h('div', {}, h('div', { class: 'fig-title', style: { fontSize: '13.5px', marginBottom: '4px' }, text: it.title }), body));
    drawPanel(it, body, pw);
  });
  host.append(grid);
}

function hypotheses(res) {
  const ids = { H1: 'labels', H2: 'transport', H3: 'recal', H4: 'passport', H5: 'rule' };
  return h('div', {}, Object.entries(res.verdicts).map(([k, v]) => h('div', { class: 'hyp' },
    h('div', {}, h('div', { class: 'status' }, statusMark(v.status), v.status.charAt(0).toUpperCase() + v.status.slice(1)), h('div', { class: 'small muted', style: { marginTop: '4px' }, text: k })),
    h('div', {}, h('h3', { text: v.title }), h('p', { text: tidy(v.headline) }), ids[k] !== 'labels' ? h('p', { class: 'small' }, h('a', { href: `#/evidence`, onclick: e => { e.preventDefault(); document.getElementById(ids[k])?.scrollIntoView({ behavior: 'smooth' }); }, text: 'Go to the figures' })) : h('p', { class: 'small' }, h('a', { href: '#/labels', text: 'Open the label audit' }))))));
}

function cohortTable(res) {
  const rows = res.cohorts.map(c => [SITE_NAME[c.site], fmt.int(c.n), fmt.int(c.deaths), fmt.num(c.followup_median, 0), fmt.num(c.age_median, 0), fmt.pct(c.er_pos), fmt.pct(c.her2_pos), fmt.pct(c.km36, 1), fmt.pct(c.km60, 1)]);
  return table(['Site', 'Patients', 'Deaths', 'Median follow-up (months)', 'Median age', 'ER positive', 'HER2 positive', 'Death by 3 y (KM)', 'Death by 5 y (KM)'], rows, { caption: 'The six evaluation sites' });
}

// ---------- discrimination ----------
function sitesForest(res, metric, o) {
  const sm = res.site_metrics.filter(r => r.model === o.model && r.horizon === o.horizon);
  const rows = SITES.map(s => sm.find(r => r.site === s)).filter(Boolean).map(r => {
    const est = o.get(r), [lo, hi] = o.ci(r);
    return { label: SITE_NAME[r.site], est, lo, hi, tipRows: [{ value: `${fmt.int(r.n)} patients, ${fmt.int(r.deaths)} deaths`, name: '' }] };
  });
  const p = res.pooled_metrics.find(r => r.model === o.model && r.horizon === o.horizon && r.metric === metric);
  if (p) rows.push({ kind: 'pooled', label: 'Pooled (random effects)', est: p.est, lo: p.lo, hi: p.hi, pi: [p.pi_lo, p.pi_hi], tipRows: [{ value: `I² ${fmt.pct(p.i2)}`, name: 'heterogeneity' }] });
  return rows;
}

function discrimination(res) {
  const rows = sitesForest(res, 'uno_c', { model: 'clinical', horizon: 36, get: r => r.uno_c, ci: r => [r.uno_c - 1.96 * r.uno_c_se, r.uno_c + 1.96 * r.uno_c_se] });
  const cmp = MODELS.map(m => { const p = res.pooled_metrics.find(r => r.model === m && r.horizon === 36 && r.metric === 'uno_c'); return { model: m, label: MODEL_SHORT[m], est: p.est, lo: p.lo, hi: p.hi, pi: [p.pi_lo, p.pi_hi], color: MODEL_COLOR[m] }; });
  const dl = res.delta_c.filter(r => r.site === 'pooled');
  const fA = figure({
    title: 'Uno C by held-out site, deployed model',
    caption: 'Concordance with censoring weights (Uno), truncated where censoring leaves enough patients under observation. Each dot is a site the model never saw; the diamond pools them and the line through it is the 95% prediction interval for a new site. The dashed value 0.5 is chance.',
    draw: (host, w) => forest(host, w, { rows, xdomain: [0.5, 0.85], ref: 0.5, refLabel: 'chance', xlabel: 'Uno C', fmtEst: v => fmt.num(v, 2), labelWidth: 170, rightWidth: 150, aria: 'Uno C by held-out site' }),
    table: () => ({ head: ['Site', 'Uno C', '95% interval'], rows: rows.map(r => [r.label, fmt.num(r.est, 3), `${fmt.num(r.lo, 3)} to ${fmt.num(r.hi, 3)}`]) }),
  });
  const fB = figure({
    title: 'Five models, pooled held-out Uno C',
    caption: `Differences between the Cox model and the flexible learners are small and their intervals overlap. Against the deployed model the pooled difference in C is ${dl.map(d => `${MODEL_SHORT[d.comparator]} ${fmt.signed(-d.delta, 3)}`).join(', ')} (positive means the comparator is better). Grey whiskers are 95% prediction intervals for a new site.`,
    draw: (host, w) => forest(host, w, { rows: cmp, xdomain: [0.5, 0.85], ref: 0.5, xlabel: 'Pooled Uno C, leave-one-site-out', fmtEst: v => fmt.num(v, 2), labelWidth: 130, rightWidth: 150, aria: 'Model comparison' }),
    table: () => ({ head: ['Model', 'Pooled Uno C', '95% interval', 'Prediction interval'], rows: cmp.map(r => [MODEL_NAME[r.model], fmt.num(r.est, 3), `${fmt.num(r.lo, 3)} to ${fmt.num(r.hi, 3)}`, `${fmt.num(r.pi[0], 3)} to ${fmt.num(r.pi[1], 3)}`]) }),
  });
  return h('div', { class: 'cols-2' }, fA, fB);
}

// ---------- calibration ----------
function calibration(res) {
  const oeRows = (() => {
    const sm = res.site_metrics.filter(r => r.model === 'clinical' && r.horizon === 36);
    const rows = SITES.map(s => sm.find(r => r.site === s)).map(r => ({ label: SITE_NAME[r.site], est: r.oe, lo: Math.exp(Math.log(r.oe) - 1.96 * r.ln_oe_se), hi: Math.exp(Math.log(r.oe) + 1.96 * r.ln_oe_se),
      tipRows: [{ value: `${fmt.pct(r.obs, 1)} observed, ${fmt.pct(r.exp, 1)} expected`, name: '' }] }));
    const p = res.pooled_metrics.find(r => r.model === 'clinical' && r.horizon === 36 && r.metric === 'oe');
    rows.push({ kind: 'pooled', label: 'Pooled (random effects)', est: p.est, lo: p.lo, hi: p.hi, pi: [p.pi_lo, p.pi_hi], tipRows: [{ value: `I² ${fmt.pct(p.i2)}`, name: 'heterogeneity' }] });
    return rows;
  })();
  const slopeRows = sitesForest(res, 'slope', { model: 'clinical', horizon: 36, get: r => r.slope, ci: r => [r.slope - 1.96 * r.slope_se, r.slope + 1.96 * r.slope_se] });
  const fOE = figure({
    title: 'Observed over expected deaths at 3 years',
    caption: 'Values below 1 mean the model predicts more deaths than occurred. The pooled estimate is close to 1, but the interval for a new site is wide: the average hides sites where the model is off by a factor of two.',
    draw: (host, w) => forest(host, w, { rows: oeRows, scale: 'log', xdomain: [0.25, 4], ref: 1, xlabel: 'Observed / expected (log scale)', fmtEst: v => fmt.num(v, 2), labelWidth: 170, rightWidth: 150, aria: 'Observed over expected deaths by site' }),
    table: () => ({ head: ['Site', 'O/E', '95% interval'], rows: oeRows.map(r => [r.label, fmt.num(r.est, 2), `${fmt.num(r.lo, 2)} to ${fmt.num(r.hi, 2)}`]) }),
  });
  const fSlope = figure({
    title: 'Calibration slope',
    caption: 'A slope of 1 means the spread of predicted risks matches the spread of observed risks. Slopes near 1 at every site say the model ranks and spreads risk correctly; the level (left figure) is what moves.',
    draw: (host, w) => forest(host, w, { rows: slopeRows, xdomain: domainOf(slopeRows, [0.4, 1.6]), ref: 1, xlabel: 'Slope of the linear predictor', fmtEst: v => fmt.num(v, 2), labelWidth: 170, rightWidth: 150, aria: 'Calibration slope by site' }),
    table: () => ({ head: ['Site', 'Slope', '95% interval'], rows: slopeRows.map(r => [r.label, fmt.num(r.est, 2), `${fmt.num(r.lo, 2)} to ${fmt.num(r.hi, 2)}`]) }),
  });
  const order = ['All held-out sites', ...SITES];
  const ymax = Math.max(0.1, Math.ceil(Math.max(...order.flatMap(k => res.calibration[k].flatMap(b => [b.pred, b.hi]))) * 10) / 10);
  const fPlot = figure({
    title: 'Predicted against observed 3-year mortality',
    legend: [{ name: 'Risk group (each dot is a quartile, or an eighth for all sites)', color: SERIES[0], ring: false }],
    caption: 'Each dot groups held-out patients by predicted risk; the vertical line is the 95% interval of the Kaplan-Meier observed risk. Points on the diagonal are perfectly calibrated. TCGA sits below it (over-prediction); several METABRIC cohorts sit above.',
    draw: (host, w) => panels(host, w, order.map(k => ({ title: k === 'All held-out sites' ? 'All held-out sites' : SITE_NAME[k], key: k })), (it, body, pw) => {
      const bins = res.calibration[it.key];
      xy(body, pw, { height: Math.round(pw * 0.85), aria: `Calibration, ${it.title}`, diag: [0, ymax],
        x: { domain: [0, ymax], format: v => fmt.pct(v), label: 'Predicted' }, y: { domain: [0, ymax], format: v => fmt.pct(v), tickWidth: 40, label: 'Observed' },
        tip: { title: x => `Predicted ${fmt.pct(x, 1)}`, fmtY: v => fmt.pct(v, 1) },
        series: [{ name: 'Observed', color: SERIES[0], kind: 'points', pts: bins.map(b => [b.pred, b.obs]), whisk: bins.map(b => [b.lo, b.hi]), extra: bins.map(b => [{ value: fmt.int(b.n), name: 'patients' }]) }] });
    }, 230),
    table: () => ({ head: ['Group', 'Patients', 'Predicted', 'Observed', '95% interval'], rows: order.flatMap(k => res.calibration[k].map((b, i) => [`${k === 'All held-out sites' ? 'All' : k} group ${i + 1}`, fmt.int(b.n), fmt.pct(b.pred, 1), fmt.pct(b.obs, 1), `${fmt.pct(b.lo, 1)} to ${fmt.pct(b.hi, 1)}`])) }),
  });
  return h('div', { class: 'stack' }, h('div', { class: 'cols-2' }, fOE, fSlope), fPlot);
}

// ---------- recalibration (H3) ----------
function recalibration(res) {
  const ns = [25, 50, 100, 200, 400];
  const ymax = Math.ceil(Math.max(...res.recal.map(r => Math.max(r.err_before, r.err_after, r.err_full))) * 50) / 50;
  const fig = figure({
    title: 'Error in 3-year risk against local sample size',
    legend: [{ name: 'Pooled model, no update', color: 'var(--muted)', kind: 'line' }, { name: 'One local factor re-estimated', color: SERIES[0], kind: 'line' }, { name: 'All coefficients re-estimated (exploratory)', color: SERIES[1], kind: 'line' }],
    caption: 'Median absolute difference between the predicted and the true 3-year risk in the held-out site, over 200 random local samples of each size (sizes larger than the whole site are not drawn). Below the grey line the update helps; above it the update adds noise. Where the pooled model was already close, a small local sample makes things worse.',
    draw: (host, w) => panels(host, w, SITES.map(s => ({ title: SITE_NAME[s], key: s })), (it, body, pw) => {
      const rows = ns.map(n => res.recal.find(r => r.site === it.key && r.n_local === n)).filter(Boolean);
      const ser = (name, color, key, extra = {}) => ({ name, color, pts: rows.map(r => [r.n_local, r[key]]), dot: false, ...extra });
      xy(body, pw, { height: Math.round(pw * 0.8), aria: `Recalibration, ${it.title}`, cross: true,
        x: { domain: [25, 400], scale: 'log', ticks: ns, format: v => String(v), label: 'Local patients' }, y: { domain: [0, ymax], format: v => fmt.pct(v), tickWidth: 40 },
        tip: { title: x => `${x} local patients`, fmtY: v => fmt.pct(v, 1) },
        series: [ser('No update', 'var(--muted)', 'err_before'), ser('One factor', SERIES[0], 'err_after'), ser('All coefficients', SERIES[1], 'err_full', { dashed: true })] });
    }, 250),
    table: () => ({ head: ['Site', 'Local patients', 'No update', 'One factor', 'All coefficients', 'Median deaths in sample'], rows: res.recal.map(r => [SITE_NAME[r.site], String(r.n_local), fmt.pct(r.err_before, 1), fmt.pct(r.err_after, 1), fmt.pct(r.err_full, 1), fmt.num(r.events, 1)]) }),
  });
  return fig;
}

// ---------- passport (H4) ----------
function passport(res) {
  const col = { SHOW: 'var(--good)', 'SHOW WITH CAUTION': 'var(--warn)', ABSTAIN: 'var(--crit)' };
  const lab = { SHOW: 'show', 'SHOW WITH CAUTION': 'caution', ABSTAIN: 'abstain' };
  const rows = [];
  for (const s of SITES) {
    rows.push({ kind: 'head', label: SITE_NAME[s] });
    for (const g of ['SHOW', 'SHOW WITH CAUTION', 'ABSTAIN']) {
      const r = res.passport_groups.find(x => x.site === s && x.group === g);
      rows.push(r ? { label: `  ${lab[g]}`, est: r.signed, lo: r.signed - 1.96 * r.se, hi: r.signed + 1.96 * r.se, color: col[g], right: `${fmt.pts(r.signed, 1)}, ${fmt.int(r.n)} patients`, tipRows: [{ value: `${fmt.pct(r.pred, 1)} predicted, ${fmt.pct(r.obs, 1)} observed`, name: '' }] } : { label: `  ${lab[g]}`, est: null, right: 'under 20 patients' });
    }
  }
  const t = res.passport_tests, ab = t.ABSTAIN, ca = t['SHOW WITH CAUTION'];
  const cn = res.canary;
  return h('div', { class: 'stack' },
    figure({
      title: 'Predicted minus observed 3-year mortality, by verdict group',
      legend: [{ name: 'Show', color: 'var(--good)' }, { name: 'Show with caution', color: 'var(--warn)' }, { name: 'Abstain', color: 'var(--crit)' }],
      caption: 'Patients at each held-out site grouped by the verdict their profile received from the other sites. If the verdicts located failure, the abstain dots would sit farther from zero than the show dots. They do not, consistently.',
      draw: (host, w) => forest(host, w, { rows, xdomain: [-0.2, 0.2], ref: 0, xlabel: 'Predicted minus observed (percentage points)', format: v => fmt.pct(v, 0), fmtEst: v => fmt.pct(v, 0), rowH: 24, labelWidth: 120, rightWidth: 210, aria: 'Calibration gap by verdict group' }),
      table: () => ({ head: ['Site', 'Verdict', 'Patients', 'Predicted', 'Observed', 'Gap'], rows: res.passport_groups.map(r => [SITE_NAME[r.site], lab[r.group], fmt.int(r.n), fmt.pct(r.pred, 1), fmt.pct(r.obs, 1), fmt.pts(r.signed, 1)]) }),
    }),
    table(['Test', 'Observed difference', 'Mean under shuffled verdicts', 'Permutation p'], [
      ['Abstain minus show, absolute gap', fmt.pts(ab.stat, 1), fmt.pts(ab.null_mean, 1), fmt.num(ab.p, 2)],
      ['Caution minus show, absolute gap', fmt.pts(ca.stat, 1), fmt.pts(ca.null_mean, 1), fmt.num(ca.p, 2)]], { caption: 'Permutation tests of the verdicts' }),
    h('p', { class: 'small ink2', text: `Shuffled-label canary: with outcomes randomly reassigned, Uno C was ${fmt.num(Math.min(...cn.map(c => c.mean)), 2)} to ${fmt.num(Math.max(...cn.map(c => c.mean)), 2)} across the six sites, as it should be (0.5 is chance), so the pipeline does not manufacture discrimination.` }));
}

// ---------- reassurance rule (H5) ----------
function ruleSection(res) {
  const prim = res.rule_eval.filter(r => r.spec === 'primary' && r.update === 'none');
  const rows = SITES.map(s => prim.find(r => r.site === s)).map(r => ({
    label: SITE_NAME[r.site], est: r.km, lo: r.deaths > 0 ? r.lo : null, hi: r.deaths > 0 ? r.hi : null, color: r.km <= 0.05 ? 'var(--good)' : 'var(--crit)',
    right: `${fmt.pct(r.km, 1)}, ${fmt.int(r.deaths)} of ${fmt.int(r.n)}`, tipRows: [{ value: `threshold ${fmt.pct(r.lam, 1)}, ${fmt.pct(r.coverage)} of the site reassured`, name: '' }] }));
  const count = (spec, upd) => { const x = res.rule_eval.filter(r => r.spec === spec && r.update === upd && r.lam != null && r.km != null); return { n: x.length, ok: x.filter(r => r.km <= r.alpha).length }; };
  const lines = [['Primary: at most 5%, minimum 250 patients', 'primary'], ['Pre-specified minimum of 100 patients', 'original_min_n'], ['Sensitivity: at most 7.5%', 'sens_7.5'], ['Sensitivity: at most 10%', 'sens_10']];
  const cell = c => (c.n === 6 ? `${c.ok} of 6` : c.n ? `${c.ok} of ${c.n} (a threshold exists in ${c.n} of 6 folds)` : 'not run');
  const tb = lines.map(([name, spec]) => [name, cell(count(spec, 'none')), cell(count(spec, 'kappa100'))]);
  return h('div', { class: 'stack' },
    figure({
      title: 'Observed 3-year mortality among reassured patients, per held-out site',
      legend: [{ name: 'At or below 5%', color: 'var(--good)' }, { name: 'Above 5%', color: 'var(--crit)' }],
      caption: 'At each site the threshold on predicted risk was chosen using only the other five sites. Patients at or below it are the reassured group. The line marks the 5% target. A site with no deaths among reassured patients has no interval to show.',
      draw: (host, w) => forest(host, w, { rows, xdomain: [0, 0.14], ref: 0.05, refLabel: '5% target', xlabel: 'Observed 3-year mortality (Kaplan-Meier)', format: v => fmt.pct(v, 0), fmtEst: v => fmt.pct(v, 0), labelWidth: 170, rightWidth: 200, aria: 'Reassurance rule, observed mortality' }),
      table: () => ({ head: ['Site', 'Threshold', 'Share reassured', 'Reassured patients', 'Deaths', 'Observed'], rows: prim.map(r => [SITE_NAME[r.site], fmt.pct(r.lam, 1), fmt.pct(r.coverage), fmt.int(r.n), fmt.int(r.deaths), fmt.pct(r.km, 1)]) }),
    }),
    table(['Specification', 'Sites at or below target, pooled model', 'After a local factor from 100 patients'], tb, { caption: 'Reassurance rule across specifications', left: [0] }),
    h('p', { class: 'small ink2', text: 'The pre-specified minimum of 100 patients leaves no certifiable threshold in most folds, because 100 patients usually include enough deaths to push the upper limit above 5%. The headline uses 250 and the change is listed in the deviation log.' }));
}

// ---------- decision curve (exploratory) ----------
function decision(res) {
  const d = res.decision, th = d.thresholds;
  const holder = h('div', { class: 'stack' });
  const sel = h('select', { id: 'dc-site', 'aria-label': 'Site' }, ['All held-out sites', ...SITES].map(k => h('option', { value: k, text: k === 'All held-out sites' ? k : SITE_NAME[k] })));
  const fig = () => {
    const key = sel.value, c = d[key];
    const ymin = -0.02, ymax = Math.max(0.02, Math.ceil(Math.max(...c.model, ...c.all) * 100) / 100 + 0.01);
    return figure({
      title: 'Net benefit of acting on predicted 3-year risk',
      legend: [{ name: 'Model', color: SERIES[0], kind: 'line' }, { name: 'Treat everyone', color: 'var(--muted)', kind: 'line' }, { name: 'Treat no one', color: SERIES[1], kind: 'line' }],
      caption: 'Net benefit counts true positives minus false positives weighted by the odds of the threshold, with censoring handled by Kaplan-Meier within each group. A curve above both references means the model would be useful at that threshold; at low thresholds, treating everyone is hard to beat.',
      draw: (host, w) => xy(host, w, { height: 300, aria: 'Decision curve', cross: true,
        x: { domain: [th[0], th.at(-1)], format: v => fmt.pct(v), label: 'Threshold risk at which action is taken' }, y: { domain: [ymin, ymax], format: v => fmt.num(v, 2), label: 'Net benefit', tickWidth: 44 },
        tip: { title: x => `Threshold ${fmt.pct(x)}`, fmtY: v => fmt.num(v, 3) },
        series: [{ name: 'Treat everyone', color: 'var(--muted)', pts: th.map((t, i) => [t, c.all[i]]), dot: false },
          { name: 'Treat no one', color: SERIES[1], pts: th.map(t => [t, 0]), dot: false },
          { name: 'Model', color: SERIES[0], pts: th.map((t, i) => [t, c.model[i]]), dot: false }] }),
      table: () => ({ head: ['Threshold', 'Model', 'Treat everyone'], rows: th.filter((t, i) => i % 3 === 0).map((t) => { const i = th.indexOf(t); return [fmt.pct(t), fmt.num(c.model[i], 4), fmt.num(c.all[i], 4)]; }) }),
    });
  };
  const paint = () => { clear(holder); holder.append(h('div', { class: 'select-row' }, h('label', { for: 'dc-site' }, 'Show'), sel), fig()); };
  sel.addEventListener('change', paint);
  paint();
  return holder;
}

// ---------- exploratory ----------
function exploratory(res) {
  const ex = res.exploratory;
  const phRows = [];
  ex.ph.forEach(p => {
    phRows.push({ kind: 'head', label: p.term });
    phRows.push({ label: '  first 5 years', est: p.hr_early, lo: p.early_lo, hi: p.early_hi, color: SERIES[0], right: `${fmt.num(p.hr_early, 2)} (${fmt.num(p.early_lo, 2)} to ${fmt.num(p.early_hi, 2)})` });
    phRows.push({ label: '  after 5 years', est: p.hr_late, lo: p.late_lo, hi: p.late_hi, color: SERIES[1], right: `${fmt.num(p.hr_late, 2)} (${fmt.num(p.late_lo, 2)} to ${fmt.num(p.late_hi, 2)})` });
  });
  const ph = figure({
    title: 'Hazard ratios early and late (landmark at 60 months)',
    legend: [{ name: 'First 5 years', color: SERIES[0] }, { name: 'After 5 years, among survivors', color: SERIES[1] }],
    caption: 'Exploratory. Where the two estimates differ, the proportional-hazards assumption is strained. Age matters more after five years; the receptor effects fade, and ER negative reverses. A single hazard ratio therefore over-states them late and under-states them early.',
    draw: (host, w) => forest(host, w, { rows: phRows, scale: 'log', xdomain: [0.5, 3], ref: 1, ticks: [0.5, 1, 1.5, 2, 3], xlabel: 'Hazard ratio (log scale)', fmtEst: v => fmt.num(v, 2), rowH: 22, labelWidth: 150, rightWidth: 190, aria: 'Hazard ratios early and late' }),
    table: () => ({ head: ['Term', 'First 5 y', 'After 5 y', 'Ratio', 'z'], rows: ex.ph.map(p => [p.term, fmt.num(p.hr_early, 2), fmt.num(p.hr_late, 2), fmt.num(p.ratio, 2), fmt.num(p.z, 1)]) }),
  });
  const ladRows = ex.ladder.map(r => ({ label: r.rung, est: r.uno_c, lo: r.lo, hi: r.hi, color: SERIES[0], tipRows: r.delta != null ? [{ value: `${fmt.signed(r.delta, 3)} (${fmt.signed(r.delta_lo, 3)} to ${fmt.signed(r.delta_hi, 3)})`, name: 'change from previous rung' }] : [] }));
  const lad = figure({
    title: 'Predictor ladder, METABRIC cohorts only',
    caption: `Pooled held-out Uno C as predictors are added. Receptors add ${fmt.signed(ex.ladder[1].delta, 3)}; HER2 and grade add little once receptors are known.`,
    draw: (host, w) => forest(host, w, { rows: ladRows, xdomain: [0.55, 0.78], xlabel: 'Pooled Uno C, leave-one-cohort-out', fmtEst: v => fmt.num(v, 2), labelWidth: 120, rightWidth: 150, aria: 'Predictor ladder' }),
    table: () => ({ head: ['Predictors', 'Uno C', '95% interval', 'Change'], rows: ex.ladder.map(r => [r.rung, fmt.num(r.uno_c, 3), `${fmt.num(r.lo, 3)} to ${fmt.num(r.hi, 3)}`, r.delta != null ? fmt.signed(r.delta, 3) : 'n/a']) }),
  });
  const epRows = ex.endpoint.map((r, i) => ({ label: r.endpoint === 'overall survival' ? 'Overall survival' : 'Breast-cancer death only', est: r.uno_c, lo: r.lo, hi: r.hi, color: SERIES[i], tipRows: [{ value: fmt.int(r.deaths), name: 'deaths' }] }));
  const ep = figure({
    title: 'Endpoint check, METABRIC cohorts',
    caption: 'The same model scored against all deaths or only deaths from breast cancer (other-cause deaths censored). Discrimination is no better for the cancer-specific endpoint, so other-cause mortality does not explain the estimates. TCGA has no cause of death.',
    draw: (host, w) => forest(host, w, { rows: epRows, xdomain: [0.55, 0.78], xlabel: 'Pooled Uno C', fmtEst: v => fmt.num(v, 2), labelWidth: 150, rightWidth: 150, aria: 'Endpoint sensitivity' }),
    table: () => ({ head: ['Endpoint', 'Deaths', 'Uno C', '95% interval'], rows: ex.endpoint.map(r => [r.endpoint, fmt.int(r.deaths), fmt.num(r.uno_c, 3), `${fmt.num(r.lo, 3)} to ${fmt.num(r.hi, 3)}`]) }),
  });
  const wnd = ex.window.filter(r => r.horizon === 36);
  const wtab = table(['Site', 'Window', 'Uno C', 'Observed / expected', 'Predicted, low-risk third', 'Observed, low-risk third'],
    SITES.flatMap(s => ['all follow-up', '60 months'].map(w => { const r = wnd.find(x => x.site === s && x.window === w); return r ? [SITE_NAME[s], w, fmt.num(r.uno_c, 3), fmt.num(r.oe, 2), fmt.pct(r.low_pred, 1), fmt.pct(r.low_obs, 1)] : null; }).filter(Boolean)), { caption: 'Estimation window sensitivity' });
  return h('div', { class: 'stack' }, h('div', { class: 'cols-2' }, ph, h('div', { class: 'stack' }, lad, ep)),
    h('div', { class: 'stack' }, h('h3', { text: 'Training on 60 months of follow-up instead of all of it' }),
      h('p', { class: 'small ink2', text: 'Exploratory. The deployed model keeps all follow-up, as pre-specified. Cutting follow-up at 60 months helps some METABRIC cohorts and hurts TCGA, so no single window is better everywhere.' }), wtab));
}

export async function render(root) {
  const res = await loadResults();
  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('h1', { text: 'What the evidence shows' }),
      h('p', { class: 'lede', text: 'One model, six sites. Each site is held out in turn: the model is fitted on the other five and scored on the one it never saw. Five hypotheses were written down before any of these results existed, and each is reported below whichever way it came out.' })),
    section('hypotheses', 'Five pre-specified hypotheses', null, hypotheses(res)),
    section('sites', 'The six sites', 'Follow-up is short in TCGA and long in METABRIC, and that single fact drives most of what follows.', cohortTable(res)),
    section('transport', 'Ranking patients transports', 'Held-out discrimination is similar at every site and does not need the flexible learners.', discrimination(res)),
    section('calibration', 'The level of risk does not transport', 'The same model predicts about twice the observed deaths in TCGA and too few in two METABRIC cohorts.', calibration(res)),
    section('recal', 'One local factor helps only where it is needed', 'Re-estimating a single factor from a hospital’s own follow-up reduced error in the two sites where the model was off, and added noise in the sites where it was already close.', recalibration(res)),
    section('passport', 'The evidence checks describe support, not accuracy', 'The checks tell a reader how much evidence exists for a profile. In held-out sites they did not separate well-calibrated profiles from badly calibrated ones.', passport(res)),
    section('rule', 'A reassurance threshold chosen elsewhere', 'A threshold on predicted risk, chosen without the held-out site, kept the observed 3-year mortality of reassured patients at or below 5% in five of six sites. These are point estimates: intervals reach above 5% wherever few patients were reassured.', ruleSection(res)),
    section('decision', 'Decision curves', 'Exploratory.', decision(res)),
    section('exploratory', 'Exploratory checks', 'None of these changes the deployed model. They are here so the limits are visible.', exploratory(res))));
}

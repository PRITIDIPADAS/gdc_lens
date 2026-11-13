import { h, clear, fmt, nextFrame } from '../lib/dom.js';
import { loadResults } from '../lib/data.js';
import { figure, forest, xy, bars, niceTicks, SERIES } from '../lib/charts.js';
import { seg, table, section } from '../lib/ui.js';
import { labelEstimators, mulberry32, simulateOnce } from '../lib/stats.js';

const GROUPS = ['TCGA', 'METABRIC (all)', 'M1', 'M2', 'M3', 'M4', 'M5'];
const GNAME = { TCGA: 'TCGA-BRCA (GDC)', 'METABRIC (all)': 'METABRIC, all five cohorts', M1: 'METABRIC cohort 1', M2: 'METABRIC cohort 2', M3: 'METABRIC cohort 3', M4: 'METABRIC cohort 4', M5: 'METABRIC cohort 5' };
const MODEL_NAME = { clinical: 'Deployed model', age_stage: 'Age + stage', stage: 'Stage only', rsf: 'Survival forest', gbsa: 'Boosted Cox' };
const C_KM = SERIES[0], C_NAIVE = SERIES[1], C_DROP = SERIES[2];
const ok = Number.isFinite;
const pp = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(100 * v).toFixed(d);
const ALIVE = 'Censored = alive', DROPPED = 'Censored dropped';

// ---------- real cohorts ----------
function realCohorts(res) {
  const holder = h('div', { class: 'stack' });
  let horizon = 36;
  const paint = () => {
    clear(holder);
    const rows = res.label_bias.filter(r => r.horizon === horizon);
    const fr = [];
    GROUPS.forEach(g => {
      const r = rows.find(x => x.group === g);
      if (!r) return;
      fr.push({ kind: 'head', label: GNAME[g] });
      [[ALIVE, 'naive', C_NAIVE], [DROPPED, 'drop', C_DROP]].forEach(([label, k, color]) => {
        const b = r[`bias_${k}`];
        fr.push(ok(b)
          ? { label, est: b, lo: r[`bias_${k}_lo`], hi: r[`bias_${k}_hi`], color, right: pp(b), tipRows: [{ value: `${fmt.pct(r[k], 1)} against ${fmt.pct(r.km, 1)} by Kaplan-Meier`, name: 'risk' }] }
          : { label, est: null, right: 'not estimable' });
      });
    });
    const vals = rows.flatMap(r => [r.bias_naive_lo, r.bias_naive_hi, r.bias_drop_lo, r.bias_drop_hi]).filter(ok);
    const lo = Math.min(-0.02, ...vals), hi = Math.max(0.02, ...vals), pad = (hi - lo) * 0.06;
    const dom = [lo - pad, hi + pad];
    const ticks = niceTicks(dom[0], dom[1], 8), step = ticks[1] - ticks[0];
    const dec = Math.abs(step * 100 - Math.round(step * 100)) < 1e-9 ? 0 : 1;
    const t = rows.find(r => r.group === 'TCGA'), m = rows.find(r => r.group === 'METABRIC (all)');
    const parts = [];
    if (t && ok(t.bias_naive)) parts.push(`TCGA, with a median follow-up of ${fmt.num(t.followup_median, 0)} months, is ${fmt.num(Math.abs(t.bias_naive) * 100, 1)} points from the censoring-aware answer when censored patients are counted as alive`);
    if (m && ok(m.bias_naive)) parts.push(`the METABRIC cohorts, with a median of ${fmt.num(m.followup_median, 0)} months, are ${fmt.num(Math.abs(m.bias_naive) * 100, 1)} points away`);
    const fig = figure({
      title: `Bias in ${horizon / 12}-year mortality against Kaplan-Meier`,
      legend: [{ name: ALIVE, color: C_NAIVE }, { name: DROPPED, color: C_DROP }],
      caption: `Estimate minus the Kaplan-Meier estimate in percentage points, with a bootstrap 95% interval. Zero means the shortcut agrees with the censoring-aware answer. ${parts.length ? `${parts.join('; ')}.`.replace(/^./, c => c.toUpperCase()) : ''}`,
      draw: (host, w) => forest(host, w, {
        rows: fr, xdomain: dom, ticks, ref: 0, xlabel: 'Estimate minus Kaplan-Meier (percentage points)', rightHead: 'Points',
        format: v => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(100 * v).toFixed(dec)}`), fmtEst: v => fmt.pts(v, 1), estName: 'bias',
        rowH: 24, labelWidth: 170, rightWidth: 64, aria: 'Label bias on the real cohorts',
      }),
      table: () => ({
        head: ['Cohort', 'Patients', 'Deaths', 'Kaplan-Meier', ALIVE, DROPPED, 'Status unknown', 'Median follow-up'],
        rows: rows.map(r => [GNAME[r.group], fmt.int(r.n), fmt.int(r.deaths), fmt.pct(r.km, 1), fmt.pct(r.naive, 1), ok(r.drop) ? fmt.pct(r.drop, 1) : 'n/a', fmt.pct(r.unknown_status, 0), `${fmt.num(r.followup_median, 0)} months`]),
      }),
    });
    holder.append(h('div', { class: 'row' }, h('span', { class: 'field-label', text: 'Horizon' }), seg({ label: 'Horizon', value: horizon, options: [{ value: 36, label: '3 years' }, { value: 60, label: '5 years' }, { value: 120, label: '10 years' }], onChange: v => { horizon = v; paint(); } })), fig);
  };
  paint();
  return holder;
}

// ---------- simulator ----------
function simulator(res) {
  const holder = h('div', { class: 'stack' });
  let risk = 0.1, shape = 1.0, L = 60;
  const grid = h('div', { class: 'stack' }), live = h('div', { class: 'stack', 'aria-live': 'polite' });
  const progress = h('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-label': 'Simulation progress' }, h('i'));
  const shapeName = { 0.8: 'Falling', 1: 'Constant', 1.5: 'Rising' };

  const paintGrid = () => {
    clear(grid);
    const rows = res.label_sim.filter(r => r.true_risk === risk && r.shape === shape).sort((a, b) => a.L - b.L);
    const dropOk = rows.filter(r => r.drop_mean < 0.95);
    const mk = (k, name, color, src) => ({ name, color, pts: src.map(r => [r.followup_median, r[k]]) });
    const mx = Math.max(risk, ...rows.map(r => r.naive_mean), ...rows.map(r => r.km_mean), ...dropOk.map(r => r.drop_mean));
    const tk = niceTicks(0, mx * 1.08, 5), step = tk[1] - tk[0], ymax = Math.min(0.6, Math.ceil((mx * 1.08) / step - 1e-9) * step);
    grid.append(figure({
      title: `Estimated 3-year mortality when the true value is ${fmt.pct(risk)}`,
      legend: [{ name: 'Kaplan-Meier', color: C_KM, kind: 'line' }, { name: ALIVE, color: C_NAIVE, kind: 'line' }, { name: DROPPED, color: C_DROP, kind: 'line' }],
      caption: 'Each point is the mean of 200 simulated cohorts of 1,000 patients with Weibull survival and uniform censoring. The thin horizontal line is the truth. Dropping censored patients is undefined until some patients are followed past 3 years, so that line starts later.',
      draw: (host, w) => xy(host, w, {
        height: 320, cross: true, aria: 'Simulated label bias against follow-up',
        x: { domain: [11, 130], scale: 'log', ticks: [12, 24, 36, 60, 120], format: v => String(v), label: 'Median follow-up (months)' },
        y: { domain: [0, ymax], format: v => fmt.pct(v), label: 'Estimated 3-year mortality', tickWidth: 44 },
        refs: [{ axis: 'y', v: risk, label: 'truth', left: true }],
        tip: { title: x => `${fmt.num(x, 0)} months median follow-up`, fmtY: v => fmt.pct(v, 1) },
        series: [mk('naive_mean', ALIVE, C_NAIVE, rows), mk('drop_mean', DROPPED, C_DROP, dropOk), mk('km_mean', 'Kaplan-Meier', C_KM, rows)],
      }),
      table: () => ({ head: ['Median follow-up', ALIVE, DROPPED, 'Kaplan-Meier'], rows: rows.map(r => [`${fmt.num(r.followup_median, 0)} months`, fmt.pct(r.naive_mean, 1), r.drop_mean < 0.95 ? fmt.pct(r.drop_mean, 1) : 'undefined', fmt.pct(r.km_mean, 1)]) }),
    }));
  };

  const lval = h('span', { class: 'num', text: `${L} months` });
  const lslider = h('input', { type: 'range', min: 36, max: 240, step: 6, value: L, 'aria-label': 'Longest possible follow-up in months' });
  lslider.addEventListener('input', () => { L = +lslider.value; lval.textContent = `${L} months`; clear(live); });

  const run = async () => {
    clear(live); progress.hidden = false;
    const reps = 200, n = 1000, rng = mulberry32(Math.round(L * 7 + shape * 1000 + risk * 100000));
    const acc = { naive: 0, km: 0, drop: 0, nd: 0 };
    for (let r = 0; r < reps; r++) {
      const { time, event } = simulateOnce(rng, n, shape, risk, 36, L);
      const e = labelEstimators(time, event, 36);
      acc.naive += e.naive; acc.km += e.km;
      if (ok(e.drop) && e.drop < 0.95) { acc.drop += e.drop; acc.nd++; }
      if (r % 20 === 19) { progress.firstChild.style.width = `${(100 * (r + 1)) / reps}%`; await nextFrame(); }
    }
    progress.hidden = true; progress.firstChild.style.width = '0';
    const dropShown = acc.nd > reps / 2;
    const rows = [{ label: ALIVE, value: acc.naive / reps, color: C_NAIVE }];
    if (dropShown) rows.push({ label: DROPPED, value: acc.drop / acc.nd, color: C_DROP });
    rows.push({ label: 'Kaplan-Meier', value: acc.km / reps, color: C_KM });
    live.append(figure({
      title: `Your run: ${reps} cohorts of ${n.toLocaleString('en-US')} patients, follow-up window ${L} months`,
      caption: `True 3-year mortality is ${fmt.pct(risk)}. ${dropShown ? '' : 'Dropping censored patients is undefined here: nobody is followed to 3 years without dying, so only deaths have a known status. '}The same seed gives the same numbers on a rerun.`,
      draw: (host, w) => bars(host, w, { rows, max: Math.max(risk * 1.6, ...rows.map(r => r.value)) * 1.1, format: v => fmt.pct(v), fmtVal: v => fmt.pct(v, 1), refs: [{ v: risk, label: 'truth' }], labelWidth: 160, aria: 'Result of the browser simulation', valName: 'mean estimate' }),
      table: () => ({ head: ['Estimator', 'Mean estimate'], rows: rows.map(r => [r.label, fmt.pct(r.value, 1)]) }),
    }));
  };

  const controls = h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '24px' } },
    h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'field-label', text: 'True 3-year mortality' }),
      seg({ label: 'True 3-year mortality', value: risk, options: [0.05, 0.1, 0.2].map(v => ({ value: v, label: fmt.pct(v) })), onChange: v => { risk = v; paintGrid(); clear(live); } })),
    h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'field-label', text: 'Hazard over time' }),
      seg({ label: 'Hazard over time', value: shape, options: [0.8, 1, 1.5].map(v => ({ value: v, label: shapeName[v] })), onChange: v => { shape = v; paintGrid(); clear(live); } })));
  const own = h('div', { class: 'stack', style: { maxWidth: '640px' } },
    h('h3', { text: 'Run it yourself' }),
    h('p', { class: 'ink2', text: 'The same generator runs in this page for the true mortality and hazard selected above. Patients enter at random over the study window, so the longest possible follow-up is the length of the study and the median observed is about half of it.' }),
    h('label', { class: 'stack', style: { gap: '6px' } }, h('span', { class: 'field-label' }, 'Longest possible follow-up', lval), lslider),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Run 200 cohorts', onclick: run })),
    progress);

  holder.append(controls, grid, own, live);
  paintGrid();

  // follow-up needed before a shortcut is within one percentage point of the truth
  const firstWithin = (risk_, shape_, key) => {
    const rows = res.label_sim.filter(x => x.true_risk === risk_ && x.shape === shape_).sort((a, b) => a.followup_median - b.followup_median);
    const hit = rows.find(x => x[key] < 0.95 && Math.abs(x[key] - risk_) <= 0.01 + 1e-9);
    return hit ? `${fmt.num(hit.followup_median, 0)} months` : 'not reached';
  };
  const need = [];
  for (const r of [0.05, 0.1, 0.2]) for (const s of [0.8, 1.0, 1.5]) need.push([fmt.pct(r), shapeName[s].toLowerCase(), firstWithin(r, s, 'naive_mean'), firstWithin(r, s, 'drop_mean')]);
  const tcga = res.label_bias.find(r => r.group === 'TCGA' && r.horizon === 36);
  holder.append(h('div', { class: 'stack' },
    h('h3', { text: 'How long must follow-up be before a shortcut is safe?' }),
    table(['True 3-year mortality', 'Hazard over time', ALIVE, DROPPED], need, { caption: 'Median follow-up at which the shortcut is within one percentage point of the truth' }),
    h('p', { class: 'small ink2', style: { maxWidth: '74ch' }, text: `Smallest simulated median follow-up at which the mean estimate is within one percentage point of the true value. The grid is coarse, so read these as orders of magnitude. For comparison, TCGA's median follow-up is ${fmt.num(tcga.followup_median, 0)} months, and at about that follow-up the simulated errors have the same signs and the same order of magnitude as the real ones above.` })));
  return holder;
}

// ---------- ranking ----------
function ranking(res) {
  const keys = [['auc_naive', ALIVE, C_NAIVE], ['auc_drop', DROPPED, C_DROP], ['auc_ipcw', 'Censoring-weighted', C_KM]];
  const fr = [];
  res.label_ranking.forEach(r => {
    fr.push({ kind: 'head', label: MODEL_NAME[r.model] });
    keys.forEach(([k, label, color]) => fr.push({ label, est: r[k], color, right: fmt.num(r[k], 3) }));
  });
  const spread = Math.max(...res.label_ranking.map(r => Math.max(r.auc_naive, r.auc_drop, r.auc_ipcw) - Math.min(r.auc_naive, r.auc_drop, r.auc_ipcw)));
  const dep = res.label_ranking.find(r => r.model === 'clinical'), as = res.label_ranking.find(r => r.model === 'age_stage');
  const order = k => [...res.label_ranking].sort((a, b) => b[k] - a[k]).map(r => MODEL_NAME[r.model]).join(', ');
  return h('div', { class: 'stack' },
    figure({
      title: 'Same models, same patients, three ways of labelling (TCGA, 3 years)',
      legend: keys.map(([, name, color]) => ({ name, color })),
      caption: `The label rule moves one model's AUC by up to ${fmt.num(spread * 100, 1)} points. On the censoring-weighted label the deployed model leads age plus stage by ${fmt.num((dep.auc_ipcw - as.auc_ipcw) * 100, 1)} points. Absolute AUCs from binary labels cannot be compared across cohorts with different follow-up.`,
      draw: (host, w) => forest(host, w, { rows: fr, xdomain: [0.6, 0.78], ticks: [0.6, 0.65, 0.7, 0.75], xlabel: 'Area under the ROC curve at 3 years', fmtEst: v => fmt.num(v, 3), estName: 'AUC', rowH: 24, labelWidth: 150, rightWidth: 50, aria: 'AUC by label rule' }),
      table: () => ({ head: ['Model', ALIVE, DROPPED, 'Censoring-weighted'], rows: res.label_ranking.map(r => [MODEL_NAME[r.model], fmt.num(r.auc_naive, 3), fmt.num(r.auc_drop, 3), fmt.num(r.auc_ipcw, 3)]) }),
    }),
    table(['Label rule', 'Models from best to worst'], keys.map(([k, name]) => [name, order(k)]), { caption: 'Model order by label rule', left: [1] }));
}

export async function render(root) {
  const res = await loadResults();
  const t = res.label_bias.find(r => r.group === 'TCGA' && r.horizon === 36);
  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('h1', { text: 'How labels mislead when follow-up is short' }),
      h('p', { class: 'lede', text: `A common shortcut turns survival data into a yes or no label: died within 3 years or not. Patients last seen alive before 3 years are counted as survivors, or dropped. In TCGA that is ${fmt.pct(t.unknown_status)} of patients.` })),
    section('real', 'On the real cohorts', 'Kaplan-Meier uses every patient for as long as they were seen. It is the reference here, and the two shortcuts are measured against it.', realCohorts(res)),
    section('sim', 'Why it happens', 'In a simulator the truth is known, so the error of each rule can be read off directly.', simulator(res)),
    section('rank', 'Does it change which model looks best?', 'It can change the order of close models, and it changes the AUC of every model.', ranking(res)),
    section('do', 'What to do instead', null, h('div', { class: 'stack', style: { maxWidth: '72ch' } },
      h('p', {}, h('b', { text: 'Use the time-to-event data. ' }), 'Kaplan-Meier risks, censoring-weighted Brier scores and Uno C use every patient and stay close to the truth when censoring is unrelated to outcome.'),
      h('p', {}, h('b', { text: 'Report follow-up next to every result. ' }), 'Give the median follow-up by the reverse Kaplan-Meier method and the share of patients whose status at the horizon is unknown.'),
      h('p', {}, h('b', { text: 'Do not compare binary-label metrics across cohorts. ' }), 'The same model shows a different AUC in a cohort with short follow-up for reasons that have nothing to do with the model.')))));
}

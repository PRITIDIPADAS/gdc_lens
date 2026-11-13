import { h, svg, clear, fmt, debounce } from '../lib/dom.js';
import { loadModel, loadGrid, loadResults } from '../lib/data.js';
import { figure, xy, SERIES } from '../lib/charts.js';
import { light, seg } from '../lib/ui.js';
import { gridIndex, rint, clamp, AGE_MIN, AGE_MAX } from '../lib/model.js';

const DEFAULTS = { age: 58, T: 2, N: 0, ER: 'pos', PR: 'pos', HER2: 'neg', kappa: 1 };
const PRESETS = [
  { name: 'Small, node-negative, hormone-receptor positive', p: { age: 58, T: 1, N: 0, ER: 'pos', PR: 'pos', HER2: 'neg' } },
  { name: 'Node-positive, triple negative', p: { age: 44, T: 2, N: 1, ER: 'neg', PR: 'neg', HER2: 'neg' } },
  { name: 'Older, larger tumour, receptors unknown', p: { age: 74, T: 3, N: 2, ER: 'unk', PR: 'unk', HER2: 'unk' } },
];
const LEVELS = ['pos', 'neg', 'unk'];
const LEVEL_LABEL = { pos: 'Positive', neg: 'Negative', unk: 'Unknown' };
const COMP = ['support', 'stability', 'precision', 'local', 'rules'];

function readParams(q) {
  const num = (k, lo, hi, d) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? clamp(v, lo, hi) : d; };
  const lvl = (k, d) => (LEVELS.includes(q.get(k)) ? q.get(k) : d);
  return { age: Math.round(num('age', AGE_MIN, AGE_MAX, DEFAULTS.age)), T: Math.round(num('T', 1, 3, DEFAULTS.T)), N: Math.round(num('N', 0, 3, DEFAULTS.N)),
    ER: lvl('ER', DEFAULTS.ER), PR: lvl('PR', DEFAULTS.PR), HER2: lvl('HER2', DEFAULTS.HER2), kappa: num('kappa', 0.2, 3, 1) };
}

// ---------- people icon array ----------
const PERSON = 'M5 3.6a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM1.6 18.4v-5.2c0-2.4 1.5-3.9 3.4-3.9s3.4 1.5 3.4 3.9v5.2c0 .5-.4.8-.8.8H2.4c-.4 0-.8-.3-.8-.8Z';
function peopleArray(est, lo, hi, withheld) {
  const cell = 24, cols = 10, w = cols * cell, hgt = cols * cell + 2;
  const a = Math.floor(100 * lo + 1e-9), b = Math.round(100 * est), c = Math.ceil(100 * hi - 1e-9);
  const s = svg('svg', { class: `people${withheld ? ' withheld' : ''}`, viewBox: `0 0 ${w} ${hgt}`, role: 'img',
    'aria-label': withheld ? 'Estimate withheld' : `${b} of 100 patients shown as affected, with a plausible range of ${a} to ${c}` });
  for (let i = 0; i < 100; i++) {
    const r = Math.floor(i / cols), col = i % cols;
    // fill from the bottom-left so the array reads like a rising tally
    const idx = (cols - 1 - r) * cols + col;
    const cls = idx < a ? 'on' : idx < b ? 'mid' : idx < c ? 'ring' : 'off';
    s.append(svg('path', { d: PERSON, class: cls, transform: `translate(${col * cell + 4},${r * cell + 1}) scale(1.0)` }));
  }
  return s;
}

// ---------- passport ----------
function decodeLights(code) { return COMP.map((_, k) => 'GAR'[Math.floor(code / 3 ** k) % 3]); }

function buildPassport(model, grid, res, p) {
  const i = gridIndex(p);
  const L = decodeLights(grid.lights[i]);
  const verdict = grid.verdict_labels[grid.verdict[i]];
  const th = res.thresholds;
  const lpRef = model.lp(model.reference);
  const hr = Math.exp(model.lp(p) - lpRef);
  const info = {
    support: { name: 'Similar patients', val: [h('b', { text: fmt.int(grid.support[i]) }), ' training patients share these categories and an age within 5 years. ', h('span', { class: 'muted', text: `${th.support[0]} or more passes; fewer than ${th.support[1]} fails.` })] },
    stability: { name: 'Stability across sites', val: [h('b', { text: fmt.num(grid.stability[i], 2) }), ' standard deviation of the log hazard ratio when each site is left out in turn. ', h('span', { class: 'muted', text: `${th.stability[0]} or less passes; above ${th.stability[1]} fails.` })] },
    precision: { name: 'Precision', val: [h('b', { text: `${fmt.pct(grid.lo36[i])} to ${fmt.pct(grid.hi36[i])}` }), ` is the 95% range of the 3-year risk across bootstrap refits (width ${fmt.num(100 * (grid.hi36[i] - grid.lo36[i]), 0)} points). `, h('span', { class: 'muted', text: `${100 * th.precision[0]} points or less passes; above ${100 * th.precision[1]} fails.` })] },
    local: { name: 'Held-out check', val: grid.local_n[i] >= 20
      ? ['Among ', h('b', { text: fmt.int(grid.local_n[i]) }), ' similar patients at sites the model had not seen, it predicted ', h('b', { text: fmt.pct(grid.local_pred[i], 1) }), ' and ', h('b', { text: fmt.pct(grid.local_obs[i], 1) }), ' died within 3 years.']
      : ['Only ', h('b', { text: fmt.int(grid.local_n[i]) }), ' similar patients exist at held-out sites, too few to check the calibration.'] },
    rules: { name: 'Clinical rules', val: grid.rules_pass[i] ? ['Risk rises with pT and pN, never falls over time or with age after 45, and stays within a 50-fold hazard ratio of a reference profile (', h('b', { text: `${fmt.num(hr, hr < 10 ? 1 : 0)}-fold` }), ' here).']
      : ['The hazard ratio against the reference profile is ', h('b', { text: `${fmt.num(hr, 0)}-fold` }), ', outside the 1/50 to 50 range checked by the audit.'] },
  };
  return { L, verdict, info, i };
}

const VERDICT_TEXT = {
  SHOW: { cls: 'v-show', title: 'Show', kind: 'G', text: () => 'All five checks pass. The estimate rests on enough similar patients, is stable when any site is left out, and held up at sites the model had not seen.' },
  'SHOW WITH CAUTION': { cls: 'v-caution', title: 'Show with caution', kind: 'A', text: (bad, k) => `No check fails, but ${bad} ${k > 1 ? 'are' : 'is'} borderline. Treat the estimate as approximate.` },
  ABSTAIN: { cls: 'v-abstain', title: 'Estimate withheld', kind: 'R', text: (bad, k) => `${bad.charAt(0).toUpperCase()}${bad.slice(1)} ${k > 1 ? 'fail' : 'fails'}. There is not enough evidence to give a reliable number for this profile.` },
};
const NAMES = { support: 'the number of similar patients', stability: 'stability across sites', precision: 'precision', local: 'the held-out check', rules: 'the rule audit' };
const listNames = ks => (ks.length > 1 ? `${ks.slice(0, -1).map(k => NAMES[k]).join(', ')} and ${NAMES[ks.at(-1)]}` : NAMES[ks[0]] || '');

// ---------- unknown receptors ----------
function dumbbell(a, b, max, w = 260) {
  const x0 = 6, x1 = w - 6, sx = v => x0 + (v / max) * (x1 - x0);
  return svg('svg', { viewBox: `0 0 ${w} 26`, width: '100%', height: 26, role: 'img', 'aria-label': `${fmt.pct(a.v, 1)} if positive, ${fmt.pct(b.v, 1)} if negative` },
    svg('line', { x1: x0, x2: x1, y1: 13, y2: 13, style: { stroke: 'var(--rule-2)' }, 'stroke-width': 1 }),
    svg('line', { x1: sx(a.v), x2: sx(b.v), y1: 13, y2: 13, style: { stroke: 'var(--ink-2)' }, 'stroke-width': 2 }),
    svg('circle', { cx: sx(a.v), cy: 13, r: 5, style: { fill: 'var(--s2)', stroke: 'var(--surface)' }, 'stroke-width': 2 }),
    svg('circle', { cx: sx(b.v), cy: 13, r: 5, style: { fill: 'var(--s1)', stroke: 'var(--surface)' }, 'stroke-width': 2 }));
}

export async function render(root, ctx) {
  const [model, grid, res] = await Promise.all([loadModel(), loadGrid(), loadResults()]);
  let state = readParams(ctx.params);
  let showAnyway = false;

  // ----- composer
  const ageNum = h('input', { type: 'number', min: AGE_MIN, max: AGE_MAX, step: 1, value: state.age, id: 'age-num', 'aria-label': 'Age in years' });
  const ageRange = h('input', { type: 'range', min: AGE_MIN, max: AGE_MAX, step: 1, value: state.age, 'aria-label': 'Age slider' });
  const kappaNum = h('input', { type: 'number', min: 0.2, max: 3, step: 0.05, value: state.kappa, 'aria-label': 'Local calibration factor' });
  const segs = {};
  const mkSeg = (key, label, options) => (segs[key] = seg({ label, options, value: state[key], onChange: v => set({ [key]: v }) }));
  const recSeg = k => mkSeg(k, k === 'HER2' ? 'HER2 status' : `${k} status`, LEVELS.map(v => ({ value: v, label: LEVEL_LABEL[v] })));

  const results = h('div', { class: 'stack', 'aria-live': 'polite' });
  const composer = h('aside', { class: 'composer', 'aria-label': 'Patient profile' },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'age-num' }, 'Age at diagnosis', h('span', { class: 'hint', text: 'years' })),
      h('div', { class: 'num-row' }, ageNum, ageRange)),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Tumour size (pT)'),
      mkSeg('T', 'Tumour size', [{ value: 1, label: 'T1', sub: '20 mm or less' }, { value: 2, label: 'T2', sub: '21 to 50' }, { value: 3, label: 'T3 or T4', sub: 'over 50' }])),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Lymph nodes (pN)'),
      mkSeg('N', 'Lymph nodes', [{ value: 0, label: 'N0', sub: 'none' }, { value: 1, label: 'N1', sub: '1 to 3' }, { value: 2, label: 'N2', sub: '4 to 9' }, { value: 3, label: 'N3', sub: '10 or more' }])),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Oestrogen receptor'), recSeg('ER')),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Progesterone receptor'), recSeg('PR')),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'HER2'), recSeg('HER2')),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Examples'),
      h('div', { class: 'row' }, PRESETS.map(pr => h('button', { class: 'chip', type: 'button', text: pr.name, onclick: () => set(pr.p) })))),
    h('details', { class: 'adv' }, h('summary', { text: 'Calibrate to a hospital' }),
      h('div', {}, h('p', { class: 'small ink2', text: 'Multiplies the baseline hazard by one factor. 1.00 is the pooled model. The Hospital page estimates this factor from your own follow-up data.' }),
        h('label', { class: 'row small' }, 'Local factor', kappaNum))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Copy link', onclick: async e => {
      try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Link copied'; setTimeout(() => (e.target.textContent = 'Copy link'), 1600); } catch { e.target.textContent = 'Copy the address bar'; }
    } }), h('button', { class: 'btn quiet', type: 'button', text: 'Reset', onclick: () => set({ ...DEFAULTS }) })));

  const sync = () => {
    ageNum.value = state.age; ageRange.value = state.age; kappaNum.value = state.kappa;
    for (const [k, el] of Object.entries(segs)) {
      [...el.children].forEach(b => { const on = String(b.dataset.v) === String(state[k]); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    }
  };
  const draw = () => { drawResults(); };
  const set = patch => { state = { ...state, ...patch }; showAnyway = false; sync(); ctx.setParams(state); draw(); };
  const debounced = debounce(draw, 40);
  ageRange.addEventListener('input', () => { state.age = +ageRange.value; ageNum.value = state.age; ctx.setParams(state); debounced(); });
  ageNum.addEventListener('input', () => { const v = +ageNum.value; if (Number.isFinite(v) && v >= AGE_MIN && v <= AGE_MAX) { state.age = Math.round(v); ageRange.value = state.age; ctx.setParams(state); debounced(); } });
  ageNum.addEventListener('change', () => set({ age: Math.round(clamp(+ageNum.value || DEFAULTS.age, AGE_MIN, AGE_MAX)) }));
  kappaNum.addEventListener('change', () => set({ kappa: clamp(+kappaNum.value || 1, 0.2, 3) }));

  // ----- results
  function drawResults() {
    const p = { ...state };
    const pp = buildPassport(model, grid, res, p);
    const k = state.kappa;
    const tr = r => 1 - Math.pow(1 - r, k);                      // risk with the baseline hazard scaled by kappa
    const r36 = model.risk(p, 36, k), r60 = model.risk(p, 60, k), r120 = model.risk(p, 120, k);
    const lo = tr(grid.lo36[pp.i]), hi = tr(grid.hi36[pp.i]);
    const bad = COMP.filter((c, j) => pp.L[j] === 'R'), amber = COMP.filter((c, j) => pp.L[j] === 'A');
    const v = VERDICT_TEXT[pp.verdict];
    const withheld = pp.verdict === 'ABSTAIN' && !showAnyway;
    const flagged = pp.verdict === 'ABSTAIN' ? bad : amber;

    clear(results);
    results.append(h('div', { class: `verdict ${v.cls}` }, light(v.kind, 34),
      h('div', { class: 'verdict-title', text: v.title }),
      h('div', { class: 'verdict-text', text: v.text(listNames(flagged), flagged.length) })));

    // estimate
    const est = h('div', { class: 'estimate' }, peopleArray(r36, lo, hi, withheld),
      h('div', {}, withheld
        ? [h('div', { class: 'est-big', text: 'Withheld' }), h('p', { class: 'est-line', style: { marginTop: '10px' }, text: 'The model still computes a number for every profile, but the evidence checks say it should not be relied on here.' }),
          h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn', type: 'button', text: 'Show the estimate anyway', onclick: () => { showAnyway = true; draw(); } }))]
        : [h('div', { class: 'est-big' }, fmt.pct(r36, r36 < 0.1 ? 1 : 0).replace('%', ''), h('small', { text: '% within 3 years' })),
          h('p', { class: 'est-line', text: `Of 100 patients with this profile, about ${Math.round(100 * r36)} die within 3 years. The plausible range is ${fmt.pct(lo)} to ${fmt.pct(hi)} (95% interval across refits).` }),
          h('div', { class: 'est-list' }, h('div', {}, h('b', { class: 'num', text: fmt.pct(r60) }), h('span', { class: 'small ink2', text: 'within 5 years' })), h('div', {}, h('b', { class: 'num', text: fmt.pct(r120) }), h('span', { class: 'small ink2', text: 'within 10 years' }))),
          h('div', { class: 'legend', style: { marginTop: '14px' } },
            h('span', {}, h('i', { class: 'swatch', style: { background: 'var(--s1)' } }), 'Die within 3 years'),
            h('span', {}, h('i', { class: 'swatch', style: { background: 'var(--s1)', opacity: 0.55 } }), 'Within the range'),
            h('span', {}, h('i', { class: 'swatch ring', style: { color: 'var(--s1)' } }), 'Upper end of the range')),
          k !== 1 ? h('p', { class: 'small ink2', style: { marginTop: '10px' }, text: `Local factor ${fmt.num(k, 2)} applied.` }) : null]));
    results.append(est);

    // passport
    results.append(h('div', { class: 'stack' },
      h('h2', { text: 'Evidence behind this estimate' }),
      h('div', { class: 'ledger', role: 'list' }, COMP.map((c, j) => h('div', { class: 'ledger-row', role: 'listitem' }, light(pp.L[j]), h('div', { class: 'ledger-name', text: pp.info[c].name }), h('div', { class: 'ledger-val' }, pp.info[c].val)))),
      h('p', { class: 'small muted', text: `Computed from the six training cohorts only, at age ${rint(p.age)}. Thresholds were fixed before any result was seen. On held-out sites the verdicts describe how much evidence exists; they did not predict where calibration fails (see Evidence).` })));

    // unknown receptors
    const unknown = ['ER', 'PR', 'HER2'].filter(r => p[r] === 'unk');
    if (unknown.length) {
      const maxv = Math.max(...unknown.flatMap(r => [model.risk({ ...p, [r]: 'pos' }, 36, k), model.risk({ ...p, [r]: 'neg' }, 36, k)])) * 1.15;
      results.append(h('div', { class: 'stack' },
        h('h3', { text: 'What a known receptor status would change' }),
        h('div', { class: 'compare' }, unknown.map(r => {
          const a = model.risk({ ...p, [r]: 'pos' }, 36, k), b = model.risk({ ...p, [r]: 'neg' }, 36, k);
          return h('div', { class: 'compare-row' }, h('span', { text: r === 'HER2' ? 'HER2' : r }), dumbbell({ v: a }, { v: b }, maxv),
            h('span', { class: 'small ink2' }, h('span', { style: { color: 'var(--s2)', fontWeight: 700 }, 'aria-hidden': 'true', text: '● ' }), `${r === 'HER2' ? 'negative' : 'positive'}: ${fmt.pct(r === 'HER2' ? b : a, 1)} `, h('span', { style: { color: 'var(--s1)', fontWeight: 700 }, 'aria-hidden': 'true', text: '● ' }), `${r === 'HER2' ? 'positive' : 'negative'}: ${fmt.pct(r === 'HER2' ? a : b, 1)}`));
        })),
        h('p', { class: 'small muted', text: 'Three-year risk if the missing result came back each way. A wide gap is the strongest reason to obtain the test.' })));
    }

    // curve
    const cur = model.curve(p, k, 120), avg = Array.from({ length: 121 }, (_, t) => [t, 1 - Math.exp(-k * model.H0(t))]);
    const ymax = Math.min(1, Math.max(0.1, Math.ceil(Math.max(cur[120].risk, avg[120][1], hi) * 10) / 10));
    results.append(figure({
      title: 'Risk of death over time',
      legend: [{ name: 'This profile', color: SERIES[0], kind: 'line' }, { name: 'Average training patient', color: 'var(--muted)', kind: 'line' }],
      caption: h('span', {}, 'Cumulative probability of death from any cause, months since diagnosis. The average training patient has every input at its training mean. The vertical mark at 36 months is the 95% range from bootstrap refits; later horizons have no interval. Move along the chart with the arrow keys.'),
      draw: (host, w) => xy(host, w, { height: 280, aria: 'Risk of death over time', cross: true,
        x: { domain: [0, 120], ticks: [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120], label: 'Months since diagnosis', format: v => (v % 24 === 0 ? String(v) : '') },
        y: { domain: [0, ymax], format: v => fmt.pct(v), label: 'Probability of death', tickWidth: 44 },
        tip: { title: x => `${x} months`, fmtY: v => fmt.pct(v, 1) },
        series: [{ name: 'Average training patient', color: 'var(--muted)', pts: avg, dot: false },
          { name: 'This profile', color: SERIES[0], pts: cur.map(q => [q.t, q.risk]) },
          { name: '3-year range', color: SERIES[0], kind: 'points', pts: [[36, r36]], whisk: [[lo, hi]] }] }),
      table: () => ({ head: ['Months', 'This profile', 'Average training patient'], rows: [0, 6, 12, 24, 36, 48, 60, 84, 108, 120].map(t => [String(t), fmt.pct(cur[t].risk, 1), fmt.pct(avg[t][1], 1)]) }),
    }));

    // reassurance rule
    results.append(reassurance(res, r36));
  }

  function reassurance(res, r36) {
    const out = h('div', { class: 'stack' });
    const sel = h('select', { 'aria-label': 'Acceptable chance of a missed death' }, ['0.05', '0.075', '0.1'].map(a => h('option', { value: a, text: `${100 * a}%` })));
    const body = h('div', { class: 'stack' });
    const paint = () => {
      const r = res.rule_final[sel.value];
      clear(body);
      if (!r || r.lam == null) return;
      const below = r36 <= r.lam;
      body.append(h('div', { class: 'note' },
        h('p', {}, h('b', { text: below ? 'Below the threshold. ' : 'Above the threshold. ' }),
          `This profile's 3-year estimate (${fmt.pct(r36, 1)}) is ${below ? 'at or below' : 'above'} ${fmt.pct(r.lam, 1)}. `,
          `Across the ${fmt.int(r.n)} training patients at or below that value, observed 3-year mortality was ${fmt.pct(r.km, 1)} (95% interval ${fmt.pct(r.lo, 1)} to ${fmt.pct(r.hi, 1)}), and these patients are ${fmt.pct(r.coverage, 0)} of the pool.`),
        h('p', { class: 'small ink2', text: 'The threshold was chosen on out-of-fold predictions so that the upper 95% limit of observed mortality stays within the target. At held-out sites the rule kept observed mortality at or below 5% in 5 of 6 sites.' })));
    };
    sel.addEventListener('change', paint);
    out.append(h('h3', { text: 'Safe to reassure?' }), h('div', { class: 'select-row' }, h('label', { for: 'alpha' }, 'Accept at most'), Object.assign(sel, { id: 'alpha' }), h('span', {}, 'of reassured patients dying within 3 years')), body);
    paint();
    return out;
  }

  const head = h('div', { class: 'page-head' },
    h('h1', { text: 'How far can this prognosis be trusted?' }),
    h('p', { class: 'lede', text: 'Enter a breast cancer profile. GDC Lens gives the 3- and 5-year mortality estimate from a model trained on TCGA-BRCA and METABRIC, and shows how much evidence stands behind it for exactly this profile.' }));
  root.append(h('div', { class: 'wrap' }, head, h('div', { class: 'predict' }, composer, results)));
  draw();
}

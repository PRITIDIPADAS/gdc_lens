// Reading and checking a hospital's own follow-up file. Pure functions; nothing here touches the network or the DOM.
import { km, reverseKM, unoCFast, calibrationInTheLarge, kappa, mulberry32 } from './stats.js';

export const HORIZONS = [36, 60, 120];
const MIN_G = 0.10;
const DAYS_PER_MONTH = 30.4375;
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : NaN);
const sdev = a => { const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / Math.max(1, a.length - 1)); };
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

// ---------- CSV ----------
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = '', quoted = false;
  const endRow = () => { row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += c;
  }
  if (cur !== '' || row.length) endRow();
  return { header: (rows[0] || []).map(s => s.trim()), rows: rows.slice(1) };
}

// ---------- columns and values ----------
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const SYNONYMS = {
  age: ['age', 'ageyears', 'ageatdiagnosis', 'ageatdiagnosisyears', 'agedx', 'ageatdiagnosisdays', 'agedays'],
  T: ['t', 'pt', 'tstage', 'tcategory', 'pathologict', 'ajccpathologict', 'pathologictstage', 'ptcategory'],
  N: ['n', 'pn', 'nstage', 'ncategory', 'pathologicn', 'ajccpathologicn', 'pathologicnstage', 'pncategory'],
  ER: ['er', 'erstatus', 'erpositive', 'estrogenreceptor', 'estrogenreceptorstatus', 'erihc', 'erihcstatus'],
  PR: ['pr', 'prstatus', 'prpositive', 'progesteronereceptor', 'progesteronereceptorstatus', 'prihc', 'prihcstatus'],
  HER2: ['her2', 'her2status', 'her2positive', 'erbb2', 'her2ihc', 'her2ihcstatus', 'her2fish'],
  time: ['timemonths', 'time', 'timetoevent', 'osmonths', 'followupmonths', 'survivalmonths', 'months', 'timeos'],
  timeDays: ['timedays', 'osdays', 'followupdays', 'days', 'daystodeathorlastfollowup', 'survivaldays'],
  timeYears: ['timeyears', 'osyears', 'followupyears', 'survivalyears', 'years'],
  event: ['event', 'status', 'death', 'died', 'osstatus', 'vitalstatus', 'deceased', 'osevent', 'dead', 'mortality'],
};
export const FIELD_LABEL = { age: 'Age', T: 'pT category', N: 'pN category', ER: 'ER status', PR: 'PR status', HER2: 'HER2 status', time: 'Follow-up time', timeDays: 'Follow-up time (days)', timeYears: 'Follow-up time (years)', event: 'Death indicator' };

export function mapColumns(header) {
  const n = header.map(norm), used = new Set(), map = {};
  for (const [field, names] of Object.entries(SYNONYMS)) {
    for (const nm of names) {
      const i = n.findIndex((x, k) => x === nm && !used.has(k));
      if (i >= 0) { map[field] = i; used.add(i); break; }
    }
  }
  return map;
}

const num = s => { const v = parseFloat(String(s ?? '').trim().replace(',', '.')); return Number.isFinite(v) ? v : null; };
const tVal = s => { const m = /^\s*t?([1-4])/i.exec(String(s ?? '')); return m ? Math.min(+m[1], 3) : null; };
const nVal = s => { const m = /^\s*n?([0-3])/i.exec(String(s ?? '')); return m ? +m[1] : null; };
const POS = new Set(['+', '1', 'y', 'yes', 'true', 'p']), NEG = new Set(['-', '0', 'n', 'no', 'false']);
const recVal = s => {
  const v = String(s ?? '').trim().toLowerCase();
  if (v.startsWith('pos') || POS.has(v)) return 'pos';
  if (v.startsWith('neg') || NEG.has(v)) return 'neg';
  return 'unk';
};
const DEAD = new Set(['1', 'true', 'yes', 'y', 'dead', 'deceased', 'died', 'death', 'event']), ALIVE = new Set(['0', 'false', 'no', 'n', 'alive', 'living', 'censored', 'lost']);
const evVal = s => {
  const v = String(s ?? '').trim().toLowerCase();
  if (DEAD.has(v) || v.startsWith('1:')) return 1;
  if (ALIVE.has(v) || v.startsWith('0:')) return 0;
  const x = num(v);
  return x === 1 ? 1 : x === 0 ? 0 : null;
};

// Returns the usable patients and a report of what was read, mapped and left out.
export function readPatients({ header, rows }) {
  const map = mapColumns(header);
  const report = { read: rows.length, used: 0, excluded: [], mapping: [], missing: [], ignored: [], notes: [], error: null };
  const required = ['age', 'T', 'N', 'event'];
  const hasTime = 'time' in map || 'timeDays' in map || 'timeYears' in map;
  report.missing = required.filter(f => !(f in map));
  if (!hasTime) report.missing.push('time');
  report.mapping = Object.entries(map).map(([field, i]) => ({ field, column: header[i] }));
  const mapped = new Set(Object.values(map));
  report.ignored = header.filter((_, i) => !mapped.has(i));
  if (report.missing.length) {
    report.error = `Missing required column${report.missing.length > 1 ? 's' : ''}: ${report.missing.map(f => (f === 'time' ? 'follow-up time' : FIELD_LABEL[f])).join(', ')}.`;
    return { patients: [], report };
  }
  for (const r of ['ER', 'PR', 'HER2']) if (!(r in map)) report.notes.push(`No ${FIELD_LABEL[r]} column: every patient is treated as unknown, which the model handles with its own term.`);

  const ageRaw = rows.map(r => num(r[map.age]));
  const ageDays = /day/i.test(header[map.age]) || median(ageRaw.filter(v => v !== null)) > 120;
  if (ageDays) report.notes.push('Age was read as days and converted to years.');
  const timeCol = 'time' in map ? 'time' : 'timeDays' in map ? 'timeDays' : 'timeYears';
  const tScale = timeCol === 'time' ? 1 : timeCol === 'timeDays' ? 1 / DAYS_PER_MONTH : 12;
  if (timeCol !== 'time') report.notes.push(`Follow-up was read in ${timeCol === 'timeDays' ? 'days' : 'years'} and converted to months.`);

  const counts = { time: 0, nonpos: 0, age: 0, T: 0, N: 0 };
  const patients = [];
  rows.forEach((r, i) => {
    const time = num(r[map[timeCol]]), event = evVal(r[map.event]);
    if (time === null || event === null) { counts.time++; return; }
    const t = time * tScale;
    if (!(t > 0)) { counts.nonpos++; return; }
    let age = ageRaw[i];
    if (age !== null && ageDays) age /= 365.25;
    if (age === null || !(age > 0) || age > 120) { counts.age++; return; }
    const T = tVal(r[map.T]);
    if (T === null) { counts.T++; return; }
    const N = nVal(r[map.N]);
    if (N === null) { counts.N++; return; }
    patients.push({
      row: i + 2, age, T, N, time: t, event,
      ER: 'ER' in map ? recVal(r[map.ER]) : 'unk', PR: 'PR' in map ? recVal(r[map.PR]) : 'unk', HER2: 'HER2' in map ? recVal(r[map.HER2]) : 'unk',
    });
  });
  const reasons = [['no survival time or status', counts.time], ['follow-up time not positive', counts.nonpos], ['age missing or implausible', counts.age], ['pT missing, Tis or TX', counts.T], ['pN missing or NX', counts.N]];
  report.excluded = reasons.filter(([, k]) => k > 0).map(([step, k]) => ({ step, patients: k }));
  report.used = patients.length;
  const out = patients.filter(p => p.age < 20 || p.age > 95).length;
  if (out) report.notes.push(`${out} patient${out > 1 ? 's are' : ' is'} outside the model's age range of 20 to 95 and ${out > 1 ? 'are' : 'is'} evaluated at the nearest limit.`);
  return { patients, report };
}

// ---------- follow-up and horizons ----------
export const tauFor = (G, cap = 60) => {
  const ok = G.t.filter((_, i) => G.S[i] >= MIN_G);
  return Math.min(cap, ok.length ? Math.max(...ok) : cap);
};
export function horizonOk(time, event, G, h) {
  let known = 0, early = 0;
  time.forEach((t, i) => { if ((t <= h && event[i] === 1) || t > h) known++; if (t <= h && event[i] === 1) early++; });
  return G.at(h) >= MIN_G && known >= 30 && early >= 5;
}
export const deathsNeeded = halfWidth => Math.ceil((1.96 / halfWidth) ** 2);
export const kappaHalfWidth = deaths => (deaths > 0 ? 1.96 / Math.sqrt(deaths) : Infinity);

// ---------- summaries ----------
const share = (a, f) => a.filter(f).length / a.length;
export function caseMix(pts) {
  return { age_median: median(pts.map(p => p.age)), er_pos: share(pts, p => p.ER === 'pos'), her2_pos: share(pts, p => p.HER2 === 'pos'), t1: share(pts, p => p.T === 1), n0: share(pts, p => p.N === 0) };
}
export function kmAt(time, event, h) {
  const f = km(time, event), est = 1 - f.at(h), se = Math.sqrt(f.variance(h));
  return { est, se, lo: Math.max(0, est - 1.96 * se), hi: Math.min(1, est + 1.96 * se), upper: est + 1.645 * se };
}
export function calibrationBins(risk, time, event, h = 36, k = 4) {
  const n = risk.length, idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => risk[a] - risk[b]), out = [];
  for (let b = 0; b < k; b++) {
    const ii = idx.slice(Math.floor((b * n) / k), Math.floor(((b + 1) * n) / k));
    const t = ii.map(i => time[i]), e = ii.map(i => event[i]), o = kmAt(t, e, h);
    out.push({ n: ii.length, pred: mean(ii.map(i => risk[i])), obs: o.est, lo: o.lo, hi: o.hi, deaths: ii.filter(i => event[i] === 1 && time[i] <= h).length });
  }
  return out;
}
export function oeInterval(c) {
  const f = Math.exp(1.96 * c.seLogOE);
  return { oe: c.oe, lo: c.oe / f, hi: c.oe * f };
}

// Local factor estimated on four fifths of the patients and applied to the fifth that was left out.
export function crossFit(model, pts, lp, { folds = 5, seed = 7, horizon = 36 } = {}) {
  const n = pts.length, rng = mulberry32(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const fold = new Array(n);
  order.forEach((p, i) => { fold[p] = i % folds; });
  const risk = Object.fromEntries(HORIZONS.map(h => [h, new Array(n)])), kappas = [];
  for (let f = 0; f < folds; f++) {
    const tr = [], te = [];
    for (let i = 0; i < n; i++) (fold[i] === f ? te : tr).push(i);
    const k = kappa(model.base_t, model.base_H, tr.map(i => lp[i]), tr.map(i => pts[i].time), tr.map(i => pts[i].event), horizon).kappa;
    kappas.push(k);
    for (const h of HORIZONS) { const H = model.H0(h); for (const i of te) risk[h][i] = 1 - Math.exp(-k * H * Math.exp(lp[i])); }
  }
  return { risk, kappas };
}

export function analyse(model, pts) {
  const time = pts.map(p => p.time), event = pts.map(p => p.event), n = pts.length, deaths = sum(event);
  const G = reverseKM(time, event);
  const lp = pts.map(p => model.lp(p));
  const risk = Object.fromEntries(HORIZONS.map(h => [h, pts.map(p => model.risk(p, h))]));
  const A = { n, deaths, time, event, lp, risk, G, tau: tauFor(G), followup: G.median(), ok: {}, km: {}, g: {}, cal: {} };
  for (const h of HORIZONS) { A.ok[h] = horizonOk(time, event, G, h); A.km[h] = kmAt(time, event, h); A.g[h] = G.at(h); }
  A.known36 = time.filter((t, i) => (t <= 36 && event[i] === 1) || t > 36).length / n;
  A.mix = caseMix(pts);
  for (const h of [36, 60]) if (A.ok[h]) { const c = calibrationInTheLarge(time, event, risk[h], h); A.cal[h] = { ...c, ...oeInterval(c) }; }
  A.meanPred = Object.fromEntries(HORIZONS.map(h => [h, mean(risk[h])]));
  if (A.ok[36]) A.bins = calibrationBins(risk[36], time, event, 36, Math.max(2, Math.min(5, Math.floor(n / 250))));
  A.kappa = kappa(model.base_t, model.base_H, lp, time, event, 36);
  A.kappaFull = kappa(model.base_t, model.base_H, lp, time, event, null);
  A.applies = A.kappa.lo > 1 || A.kappa.hi < 1;
  A.local = Object.fromEntries(HORIZONS.map(h => [h, risk[h].map((_, i) => 1 - Math.exp(-A.kappa.kappa * model.H0(h) * Math.exp(lp[i])))]));
  if (deaths >= 10 && A.ok[36]) {
    A.cv = crossFit(model, pts, lp);
    const c = calibrationInTheLarge(time, event, A.cv.risk[36], 36);
    A.cv.cal = { ...c, ...oeInterval(c) };
  }
  return A;
}

export function ruleCheck(risk, time, event, lam, h = 36) {
  const idx = [];
  risk.forEach((r, i) => { if (r <= lam) idx.push(i); });
  const base = { lam, n: idx.length, share: idx.length / risk.length };
  if (idx.length < 5) return { ...base, status: 'too few' };
  const o = kmAt(idx.map(i => time[i]), idx.map(i => event[i]), h);
  return { ...base, deaths: idx.filter(i => event[i] === 1 && time[i] <= h).length, ...o, status: idx.length < 30 ? 'too few' : 'ok' };
}
export const ruleStatus = (r, alpha) => (r.status === 'too few' ? 'Too few to judge' : r.upper <= alpha ? 'Within target' : r.lo > alpha ? 'Above target' : 'Unclear');

// Bootstrap standard error of Uno C with the censoring distribution re-estimated in every resample.
export async function bootstrapUno(time, event, risk, tau, { B = 200, seed = 11, onProgress } = {}) {
  const n = time.length, rng = mulberry32(seed), vals = [];
  const t = new Array(n), e = new Array(n), r = new Array(n);
  let last = performance.now();
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) { const k = Math.floor(rng() * n); t[i] = time[k]; e[i] = event[k]; r[i] = risk[k]; }
    const c = unoCFast(t, e, r, tau);
    if (Number.isFinite(c)) vals.push(c);
    if (performance.now() - last > 40) { if (onProgress) onProgress((b + 1) / B); await new Promise(res => setTimeout(res, 0)); last = performance.now(); }
  }
  return { sd: sdev(vals), n: vals.length };
}

export const verdictCounts = (pts, grid, gridIndex) => {
  const c = grid.verdict_labels.map(() => 0);
  for (const p of pts) c[grid.verdict[gridIndex(p)]]++;
  return grid.verdict_labels.map((label, i) => ({ label, n: c[i], share: c[i] / pts.length }));
};

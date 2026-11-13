// Reading TCGA-BRCA clinical records from the GDC API and re-running the headline checks. Parsing mirrors gdclens/data.py.
import { reverseKM, unoCFast, tdAuc, calibrationInTheLarge, kappa, labelEstimators } from './stats.js';
import { tauFor } from './hospital.js';

export const API = 'https://api.gdc.cancer.gov';
export const PROJECT = 'TCGA-BRCA';
export const FIELDS = [
  'submitter_id', 'demographic.vital_status', 'demographic.days_to_death',
  'diagnoses.age_at_diagnosis', 'diagnoses.ajcc_pathologic_t', 'diagnoses.ajcc_pathologic_n', 'diagnoses.ajcc_pathologic_m',
  'diagnoses.days_to_last_follow_up', 'follow_ups.days_to_follow_up',
];
const DAYS_PER_MONTH = 30.4375, DAYS_PER_YEAR = 365.25;
const T_RE = /^\s*T([1-4])/i, N_RE = /^\s*N([0-3])/i;
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

// A plain GET keeps the request "simple" for the browser: no preflight round trip.
export function casesUrl(size = 2000) {
  const filters = { op: 'in', content: { field: 'cases.project.project_id', value: [PROJECT] } };
  return `${API}/cases?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${FIELDS.join(',')}&format=JSON&size=${size}`;
}
export const statusUrl = () => `${API}/status`;

export function parseGdc(hits) {
  const log = [['cases returned', hits.length]];
  const drop = { time: 0, nonpos: 0, age: 0, T: 0, N: 0, m1: 0 };
  const pts = [];
  for (const c of hits) {
    const o = c && typeof c === 'object' ? c : {};
    const dm = o.demographic && typeof o.demographic === 'object' ? o.demographic : {};
    const dx = Array.isArray(o.diagnoses) && o.diagnoses[0] && typeof o.diagnoses[0] === 'object' ? o.diagnoses[0] : {};
    const fus = Array.isArray(o.follow_ups) ? o.follow_ups : [];
    const seen = [num(dx.days_to_last_follow_up), ...fus.map(u => num(u && u.days_to_follow_up))].filter(Number.isFinite);
    const last = seen.length ? Math.max(...seen) : NaN;
    const dead = String(dm.vital_status || '').trim().toLowerCase() === 'dead';
    const days = dead ? num(dm.days_to_death) : last;
    if (!Number.isFinite(days)) { drop.time++; continue; }
    const time = days / DAYS_PER_MONTH;
    if (!(time > 0)) { drop.nonpos++; continue; }
    const age = num(dx.age_at_diagnosis) / DAYS_PER_YEAR;
    if (!Number.isFinite(age)) { drop.age++; continue; }
    const tm = T_RE.exec(String(dx.ajcc_pathologic_t || ''));
    if (!tm) { drop.T++; continue; }
    const nm = N_RE.exec(String(dx.ajcc_pathologic_n || ''));
    if (!nm) { drop.N++; continue; }
    if (String(dx.ajcc_pathologic_m || '').toUpperCase().startsWith('M1')) { drop.m1++; continue; }
    pts.push({ age, T: Math.min(+tm[1], 3), N: +nm[1], ER: 'unk', PR: 'unk', HER2: 'unk', time, event: dead ? 1 : 0 });
  }
  log.push(['no survival time or status', drop.time], ['follow-up time not positive', drop.nonpos], ['age missing', drop.age],
    ['pT missing, Tis or TX', drop.T], ['pN missing or NX', drop.N], ['metastatic at diagnosis (M1)', drop.m1]);
  return { pts, log };
}

// The reduced model (age, pT, pN; built from METABRIC only) scored on the TCGA records.
export function liveMetrics(model, pts) {
  const time = pts.map(p => p.time), event = pts.map(p => p.event), n = pts.length;
  const G = reverseKM(time, event), tau = tauFor(G);
  const lp = pts.map(p => model.lp(p)), risk36 = pts.map(p => model.risk(p, 36));
  const cal = calibrationInTheLarge(time, event, risk36, 36);
  const k = kappa(model.base_t, model.base_H, lp, time, event, 36);
  const lab = labelEstimators(time, event, 36);
  return {
    n, deaths: event.reduce((a, b) => a + b, 0), followup_median: G.median(), tau,
    uno_c: unoCFast(time, event, lp, tau), auc36: tdAuc(time, event, lp, 36),
    oe36: cal.oe, obs36: cal.obs, exp36: cal.exp, kappa36: k.kappa, kappa_lo: k.lo, kappa_hi: k.hi,
    unknown36: lab.unknown, naive36: lab.naive,
  };
}

export async function getJson(url, ms = 25000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`The GDC answered with status ${r.status}`);
    return await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The GDC did not answer within 25 seconds' : e.message === 'Failed to fetch' ? 'The request was blocked or the GDC could not be reached' : e.message);
  } finally { clearTimeout(timer); }
}

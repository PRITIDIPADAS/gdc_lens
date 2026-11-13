// Exhaustive audit of the deployed model over its whole input grid (mirrors gdclens/audit.py).
import { gridProfiles, GRID_SIZE } from './model.js';

const HORIZONS = [36, 60, 120];
const SA = 324, ST = 108, SN = 27, SER = 9, SPR = 3, SH = 1; // strides of age, T, N, ER, PR, HER2 in the grid
const HR_BOUND = 50;

export const RULE_TEXT = {
  probability: 'Predicted risks are finite and within 0 to 1',
  horizon: 'Risk does not fall as the horizon lengthens (3, 5, 10 years)',
  T: 'Risk does not fall as pT rises, other inputs fixed',
  N: 'Risk does not fall as pN rises, other inputs fixed',
  age: 'From age 45, risk does not fall with age, other inputs fixed',
  hr: 'Hazard ratio against the reference profile stays within 1/50 to 50',
  unknown_advisory: 'Advisory: an unknown receptor gives a risk between its positive and negative values',
};

export function auditGrid(model, tol = 1e-12) {
  const n = GRID_SIZE, lp = new Float64Array(n);
  let i = 0;
  for (const p of gridProfiles()) lp[i++] = model.lp(p);
  const H = HORIZONS.map(h => model.H0(h));
  const risk = H.map(h => lp.map(l => 1 - Math.exp(-h * Math.exp(l))));
  const lpRef = model.lp(model.reference);
  const fail = Object.fromEntries(Object.keys(RULE_TEXT).map(k => [k, new Uint8Array(n)]));
  for (let k = 0; k < n; k++) {
    const r = risk.map(a => a[k]);
    if (!r.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) fail.probability[k] = 1;
    if (!(r[0] <= r[1] + tol && r[1] <= r[2] + tol)) fail.horizon[k] = 1;
    if (Math.abs(lp[k] - lpRef) > Math.log(HR_BOUND)) fail.hr[k] = 1;
    const t = Math.floor(k / ST) % 3, nn = Math.floor(k / SN) % 4, a = Math.floor(k / SA);
    if (t < 2 && lp[k + ST] - lp[k] < -tol) { fail.T[k] = 1; fail.T[k + ST] = 1; }
    if (nn < 3 && lp[k + SN] - lp[k] < -tol) { fail.N[k] = 1; fail.N[k + SN] = 1; }
    if (a >= 25 && a < 75 && lp[k + SA] - lp[k] < -tol) fail.age[k + SA] = 1;
    for (const s of [SER, SPR, SH]) {
      if (Math.floor(k / s) % 3 !== 2) continue;
      const pos = lp[k - 2 * s], neg = lp[k - s];
      if (lp[k] < Math.min(pos, neg) - tol || lp[k] > Math.max(pos, neg) + tol) fail.unknown_advisory[k] = 1;
    }
  }
  const summary = { profiles: n };
  let pass = 0;
  for (const key of Object.keys(RULE_TEXT)) summary[key] = { n_fail: fail[key].reduce((a, b) => a + b, 0) };
  for (let k = 0; k < n; k++) if (!(fail.probability[k] || fail.horizon[k] || fail.T[k] || fail.N[k] || fail.age[k] || fail.hr[k])) pass++;
  summary.all_rules_pass = pass;
  return { summary, risk: { 36: risk[0], 60: risk[1], 120: risk[2] } };
}

export function maxRiskDifference(computed, grid) {
  let worst = 0;
  for (const [h, key] of [[36, 'risk36'], [60, 'risk60'], [120, 'risk120']]) {
    const a = computed.risk[h], b = grid[key];
    for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); if (d > worst) worst = d; }
  }
  return worst;
}

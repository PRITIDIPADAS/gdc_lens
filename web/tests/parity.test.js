// The browser statistics and the deployed model against reference numbers written by the Python code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/lib/stats.js';
import { Model, gridIndex, GRID_SIZE, gridProfiles } from '../src/lib/model.js';
import { auditGrid, maxRiskDifference } from '../src/lib/audit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = f => JSON.parse(fs.readFileSync(path.join(here, '..', 'public', 'data', f), 'utf8'));
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} vs ${b}`);

const P = data('parity.json');

test('Kaplan-Meier, censoring distribution and median follow-up', () => {
  const f = S.km(P.time, P.event), G = S.reverseKM(P.time, P.event);
  P.grid.forEach((x, i) => {
    near(f.at(x), P.km[i], 1e-12, `km(${x})`);
    near(f.variance(x), P.km_var[i], 1e-12, `var(${x})`);
    near(G.left(x), P.G_left[i], 1e-12, `G.left(${x})`);
    near(G.at(x), P.G_at[i], 1e-12, `G.at(${x})`);
  });
  near(S.medianFollowup(P.time, P.event), P.median_followup, 1e-12);
});

test('weights, Brier score, Uno C, AUC and calibration in the large', () => {
  const w = S.ipcwWeights(P.time, P.event, 36, S.reverseKM(P.time, P.event));
  P.weights36.forEach((v, i) => near(w[i], v, 1e-10, `weight ${i}`));
  const b = S.brier(P.time, P.event, P.risk36, 36);
  near(b.brier, P.brier36.brier, 1e-10); near(b.null, P.brier36.null, 1e-10); near(b.skill, P.brier36.skill, 1e-10);
  near(S.unoC(P.time, P.event, P.lp, 60), P.uno_c, 1e-10);
  near(S.unoCFast(P.time, P.event, P.lp, 60), P.uno_c, 1e-10);
  near(S.tdAuc(P.time, P.event, P.lp, 36), P.auc36, 1e-10);
  const c = S.calibrationInTheLarge(P.time, P.event, P.risk36, 36);
  near(c.obs, P.cal36.obs, 1e-12); near(c.exp, P.cal36.exp, 1e-12); near(c.oe, P.cal36.oe, 1e-12);
  near(c.seLogOE, P.cal36.se_log_oe, 1e-12); near(c.diff, P.cal36.diff, 1e-12);
});

test('local factor and its exact interval', () => {
  for (const [key, horizon] of [['kappa36', 36], ['kappa_full', null]]) {
    const k = S.kappa(P.base_t, P.base_H, P.lp, P.time, P.event, horizon), r = P[key];
    near(k.kappa, r.kappa, 1e-9, key); near(k.observed, r.observed, 0); near(k.expected, r.expected, 1e-9);
    near(k.lo, r.lo, 1e-6, `${key} lo`); near(k.hi, r.hi, 1e-6, `${key} hi`);
  }
});

test('label estimators', () => {
  for (const [key, h] of [['label36', 36], ['label60', 60]]) {
    const e = S.labelEstimators(P.time, P.event, h), r = P[key];
    near(e.naive, r.naive, 1e-12); near(e.drop, r.drop, 1e-12); near(e.km, r.km, 1e-12); near(e.ipcw, r.ipcw, 1e-12);
    near(e.unknown, r.unknown, 1e-12); assert.equal(e.nKnown, r.n_known);
  }
});

test('chi-squared quantiles', () => { for (const [p, df, v] of P.chi2) near(S.chi2ppf(p, df), v, 1e-6, `chi2(${p},${df})`); });

test('the fast concordance equals the pairwise one, including ties', () => {
  const rng = S.mulberry32(42);
  for (let s = 0; s < 40; s++) {
    const n = 60 + s * 3, t = [], e = [], r = [];
    for (let i = 0; i < n; i++) { t.push(Math.ceil(rng() * 30)); e.push(rng() < 0.5 ? 1 : 0); r.push(Math.round(rng() * 6) / 6); }
    near(S.unoCFast(t, e, r, 20), S.unoC(t, e, r, 20), 1e-12, `case ${s}`);
  }
});

test('the deployed model reproduces the Python risks on 150 profiles', () => {
  const model = new Model(data('model.json')), pm = data('parity_model.json');
  pm.profiles.forEach((p, i) => {
    near(model.lp(p), pm.lp[i], 1e-8, `lp ${i}`);
    for (const h of [36, 60, 120]) near(model.risk(p, h), pm[`risk${h}`][i], 1e-8, `risk${h} ${i}`);
  });
});

test('grid indexing follows the order of the profile generator', () => {
  let i = 0;
  for (const p of gridProfiles()) { if (gridIndex(p) !== i) assert.fail(`index ${i}`); i++; }
  assert.equal(i, GRID_SIZE);
});

test('the audit re-derived in the browser equals the published audit and table', () => {
  const model = new Model(data('model.json')), res = data('results.json'), grid = data('grid.json');
  const a = auditGrid(model), pub = res.audit.summary;
  for (const k of ['probability', 'horizon', 'T', 'N', 'age', 'hr', 'unknown_advisory']) assert.equal(a.summary[k].n_fail, pub[k].n_fail, k);
  assert.equal(a.summary.all_rules_pass, pub.all_rules_pass);
  assert.ok(maxRiskDifference(a, grid) < 1e-6);
});

test('the simulator in the browser recovers the true risk with Kaplan-Meier', () => {
  const rng = S.mulberry32(7);
  let km = 0, reps = 40;
  for (let r = 0; r < reps; r++) { const { time, event } = S.simulateOnce(rng, 1000, 1, 0.1, 36, 120); km += S.labelEstimators(time, event, 36).km; }
  near(km / reps, 0.1, 0.03);
});

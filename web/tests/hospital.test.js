import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Model, gridIndex } from '../src/lib/model.js';
import { unoCFast, tdAuc } from '../src/lib/stats.js';
import { parseCsv, readPatients, analyse, bootstrapUno, ruleCheck, ruleStatus, deathsNeeded, kappaHalfWidth, verdictCounts, tauFor } from '../src/lib/hospital.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = f => path.join(here, '..', 'public', f);
const data = f => JSON.parse(fs.readFileSync(pub(`data/${f}`), 'utf8'));
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} vs ${b}`);

test('parseCsv handles a byte order mark, CRLF, quotes, blank lines and other delimiters', () => {
  const a = parseCsv('﻿age,note\r\n58,"a, b"\r\n47,"say ""hi"""\r\n\r\n');
  assert.deepEqual(a.header, ['age', 'note']);
  assert.deepEqual(a.rows, [['58', 'a, b'], ['47', 'say "hi"']]);
  assert.deepEqual(parseCsv('age;T\n58;1\n').rows, [['58', '1']]);
  assert.deepEqual(parseCsv('age\tT\n58\t1').rows, [['58', '1']]);
});

test('column names and values are recognised loosely, and each exclusion is counted once', () => {
  const csv = ['Age at Diagnosis,pT,pN,ER Status,PR Status,HER2 Status,OS_MONTHS,OS_STATUS',
    '58,T1c,N0,Positive,Positive,Negative,61.2,0:LIVING',
    '47,T2,N1mi,Negative,Negative,Positive,34,1:DECEASED',
    '71,T4b,N3a,Indeterminate,,Equivocal,18.5,1:DECEASED',
    '80,Tis,N0,pos,pos,neg,10,0:LIVING',
    '60,T2,NX,pos,pos,neg,10,0:LIVING',
    '60,T2,N0,pos,pos,neg,0,0:LIVING',
    ',T2,N0,pos,pos,neg,12,0:LIVING',
    '55,T2,N0,pos,pos,neg,,0:LIVING'].join('\n');
  const { patients, report } = readPatients(parseCsv(csv));
  assert.equal(report.read, 8); assert.equal(report.used, 3); assert.equal(patients.length, 3);
  assert.deepEqual(patients.map(p => [p.row, p.T, p.N, p.ER, p.PR, p.HER2, p.event]), [[2, 1, 0, 'pos', 'pos', 'neg', 0], [3, 2, 1, 'neg', 'neg', 'pos', 1], [4, 3, 3, 'unk', 'unk', 'unk', 1]]);
  assert.deepEqual(report.excluded.map(e => [e.step, e.patients]), [['no survival time or status', 1], ['follow-up time not positive', 1], ['age missing or implausible', 1], ['pT missing, Tis or TX', 1], ['pN missing or NX', 1]]);
});

test('days are converted to years and months', () => {
  const { patients, report } = readPatients(parseCsv('age_at_diagnosis_days,t,n,days,vital_status\n21915,2,1,914.4375,Dead\n'));
  assert.equal(patients.length, 1);
  near(patients[0].age, 60, 1e-9); near(patients[0].time, 30.04, 0.01); assert.equal(patients[0].event, 1);
  assert.ok(report.notes.length >= 2);
});

test('a missing required column is reported, and missing receptors become unknown', () => {
  const bad = readPatients(parseCsv('age,T,time_months,event\n58,1,12,0\n'));
  assert.match(bad.report.error, /pN/); assert.equal(bad.patients.length, 0);
  const ok = readPatients(parseCsv('age,T,N,time_months,event\n58,1,0,12,0\n'));
  assert.equal(ok.patients[0].ER, 'unk'); assert.equal(ok.report.notes.filter(n => /unknown/.test(n)).length, 3);
});

const model = new Model(data('model.json'));
const demo = readPatients(parseCsv(fs.readFileSync(pub('demo_hospital.csv'), 'utf8')));
const ref = data('parity_hospital.json');
const A = analyse(model, demo.patients);

test('the demo file is read without loss', () => { assert.equal(demo.report.used, ref.n); assert.equal(demo.report.excluded.length, 0); });

test('the hospital checks equal the Python numbers on the demo file', () => {
  assert.equal(A.n, ref.n); assert.equal(A.deaths, ref.deaths); assert.equal(A.tau, ref.tau);
  near(A.followup, ref.followup_median, 1e-9);
  near(unoCFast(A.time, A.event, A.lp, A.tau), ref.uno_c, 1e-9);
  near(tdAuc(A.time, A.event, A.lp, 36), ref.auc36, 1e-9);
  near(A.km[36].est, ref.km36, 1e-12); near(A.km[36].se, ref.km36_se, 1e-12);
  near(A.cal[36].obs, ref.cal36.obs, 1e-12); near(A.cal[36].exp, ref.cal36.exp, 1e-9); near(A.cal[36].oe, ref.cal36.oe, 1e-9);
  near(A.cal[36].seLogOE, ref.cal36.se_log_oe, 1e-9);
  near(A.kappa.kappa, ref.kappa36.kappa, 1e-9); near(A.kappa.lo, ref.kappa36.lo, 1e-6); near(A.kappa.hi, ref.kappa36.hi, 1e-6);
  near(A.kappaFull.kappa, ref.kappa_full.kappa, 1e-9);
  near(A.meanPred[36], ref.mean_risk36, 1e-9); near(A.known36, ref.known36, 1e-12);
  const r = ruleCheck(A.risk[36], A.time, A.event, ref.rule.lam);
  assert.equal(r.n, ref.rule.n); near(r.est, ref.rule.est, 1e-9); near(r.upper, ref.rule.upper, 1e-9);
});

test('the local factor is recovered and cross-fitting removes the miscalibration', () => {
  assert.ok(A.kappa.hi < 1 && A.applies);
  assert.ok(A.cv.cal.oe > 0.85 && A.cv.cal.oe < 1.18, `cross-fitted O/E ${A.cv.cal.oe}`);
  assert.ok(A.cv.kappas.length === 5 && A.cv.kappas.every(k => k > 0.4 && k < 1));
  assert.equal(analyse(model, demo.patients).cv.cal.oe, A.cv.cal.oe);
});

test('the bootstrap is deterministic and plausible', async () => {
  const a = await bootstrapUno(A.time, A.event, A.lp, A.tau, { B: 40, seed: 3 });
  const b = await bootstrapUno(A.time, A.event, A.lp, A.tau, { B: 40, seed: 3 });
  assert.equal(a.sd, b.sd); assert.ok(a.sd > 0.008 && a.sd < 0.05, `sd ${a.sd}`);
});

test('rule statuses and sample-size helpers', () => {
  const r = ruleCheck(A.risk[36], A.time, A.event, 0.0684);
  assert.equal(ruleStatus(r, 0.05), 'Within target');
  assert.equal(ruleStatus({ status: 'too few' }, 0.05), 'Too few to judge');
  assert.equal(deathsNeeded(0.2), 97); assert.equal(deathsNeeded(0.1), 385);
  near(kappaHalfWidth(100), 0.196, 1e-12);
});

test('evidence verdicts cover every patient', () => {
  const grid = data('grid.json'), vc = verdictCounts(demo.patients, grid, gridIndex);
  assert.equal(vc.reduce((a, v) => a + v.n, 0), demo.patients.length); assert.equal(vc.length, 3);
});

test('tau follows the censoring distribution', () => {
  assert.equal(tauFor({ t: [10, 30, 70], S: [0.9, 0.5, 0.05] }), 30);
  assert.equal(tauFor({ t: [10], S: [0.9] }), 10);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGdc, casesUrl, FIELDS, liveMetrics } from '../src/lib/gdc.js';

const dx = (t, n, m, age, last) => ({ ajcc_pathologic_t: t, ajcc_pathologic_n: n, ajcc_pathologic_m: m, age_at_diagnosis: age, days_to_last_follow_up: last });
const hit = (vital, death, d, fu = []) => ({ submitter_id: 'x', demographic: { vital_status: vital, days_to_death: death }, diagnoses: [d], follow_ups: fu });

test('records are filtered and coded like the Python harmonisation', () => {
  const hits = [
    hit('Alive', null, dx('T1c', 'N0', 'M0', 21915, 913)),                         // kept
    hit('Dead', 600, dx('T4b', 'N1mi', 'M0', 18262.5, null)),                      // kept, T4 merged into 3
    hit('Alive', null, dx('T2', 'N2a', 'M0', 25000, 100), [{ days_to_follow_up: 400 }]), // longest follow-up used
    hit('Dead', null, dx('T2', 'N0', 'M0', 20000, 50)),                            // dead without a date
    hit('Alive', null, dx('T2', 'N0', 'M0', 20000, 0)),                            // time not positive
    hit('Alive', null, dx('T2', 'N0', 'M0', null, 100)),                           // no age
    hit('Alive', null, dx('Tis', 'N0', 'M0', 20000, 100)),                         // no pT
    hit('Alive', null, dx('T2', 'NX', 'M0', 20000, 100)),                          // no pN
    hit('Alive', null, dx('T2', 'N0', 'M1', 20000, 100)),                          // metastatic
    null, {},
  ];
  const { pts, log } = parseGdc(hits);
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map(p => [p.T, p.N, p.event]), [[1, 0, 0], [3, 1, 1], [2, 2, 0]]);
  assert.ok(Math.abs(pts[0].age - 60) < 1e-9);
  assert.ok(Math.abs(pts[2].time - 400 / 30.4375) < 1e-9);
  assert.deepEqual(log.map(r => r[1]), [11, 3, 1, 1, 1, 1, 1]);
});

test('the request is a plain GET for the clinical fields of one project', () => {
  const u = decodeURIComponent(casesUrl());
  assert.ok(u.startsWith('https://api.gdc.cancer.gov/cases?filters='));
  assert.ok(u.includes('"TCGA-BRCA"') && u.includes('format=JSON'));
  for (const f of FIELDS) assert.ok(u.includes(f));
  assert.ok(!/gender|race|ethnicity/.test(u));
});

test('the reduced model can be scored on parsed records', async () => {
  const fs = await import('node:fs'), { Model } = await import('../src/lib/model.js');
  const m = new Model(JSON.parse(fs.readFileSync(new URL('../public/data/model_reduced.json', import.meta.url))));
  const rng = (() => { let a = 5; return () => (a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
  const pts = Array.from({ length: 400 }, () => ({ age: 40 + 40 * rng(), T: 1 + Math.floor(rng() * 3), N: Math.floor(rng() * 4), ER: 'unk', PR: 'unk', HER2: 'unk', time: 1 + 100 * rng(), event: rng() < 0.2 ? 1 : 0 }));
  const r = liveMetrics(m, pts);
  assert.equal(r.n, 400); assert.ok(r.uno_c > 0.3 && r.uno_c < 0.7); assert.ok(r.kappa36 > 0);
});

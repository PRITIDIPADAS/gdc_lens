// The deployed Cox model, evaluated in the browser from its coefficients (mirrors gdclens/models.py).
import { stepLookup } from './stats.js';

export const AGE_MIN = 20, AGE_MAX = 95;
export const LEVEL = { pos: 0, neg: 1, unk: 2 };
const FEATURES = {
  'T>=2': p => +(p.T >= 2), 'T>=3': p => +(p.T >= 3),
  'N>=1': p => +(p.N >= 1), 'N>=2': p => +(p.N >= 2), 'N>=3': p => +(p.N >= 3),
  ER_neg: p => +(p.ER === 'neg'), ER_unk: p => +(p.ER === 'unk'),
  PR_neg: p => +(p.PR === 'neg'), PR_unk: p => +(p.PR === 'unk'),
  HER2_pos: p => +(p.HER2 === 'pos'), HER2_unk: p => +(p.HER2 === 'unk'),
};

export const rint = x => { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; };
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export class Model {
  constructor(json) {
    Object.assign(this, json);
    this.feat = this.terms.map((name, j) => ({ name, j })).filter(o => o.name in FEATURES);
  }
  ageEffect(age) {
    const a = clamp(age, AGE_MIN, AGE_MAX), i = Math.min(Math.floor(a - AGE_MIN), this.age_table.length - 2);
    return this.age_table[i] + (a - AGE_MIN - i) * (this.age_table[i + 1] - this.age_table[i]);
  }
  lp(p) {
    let s = this.ageEffect(p.age) - this.age_mean;
    for (const { name, j } of this.feat) s += (FEATURES[name](p) - this.mean[j]) * this.beta[j];
    return s;
  }
  H0(t) { return stepLookup(this.base_t, this.base_H, t); }
  risk(p, h, kappa = 1) { return 1 - Math.exp(-kappa * this.H0(h) * Math.exp(this.lp(p))); }
  curve(p, kappa = 1, tmax = 120) {
    const e = Math.exp(this.lp(p));
    return Array.from({ length: tmax + 1 }, (_, t) => ({ t, risk: 1 - Math.exp(-kappa * this.H0(t) * e) }));
  }
}

export const gridIndex = p => {
  const a = clamp(rint(p.age), AGE_MIN, AGE_MAX) - AGE_MIN;
  return ((((a * 3 + (p.T - 1)) * 4 + p.N) * 3 + LEVEL[p.ER]) * 3 + LEVEL[p.PR]) * 3 + LEVEL[p.HER2];
};
export const GRID_SIZE = (AGE_MAX - AGE_MIN + 1) * 3 * 4 * 27;

export function* gridProfiles() {
  const lv = ['pos', 'neg', 'unk'];
  for (let age = AGE_MIN; age <= AGE_MAX; age++) for (let T = 1; T <= 3; T++) for (let N = 0; N <= 3; N++)
    for (const ER of lv) for (const PR of lv) for (const HER2 of lv) yield { age, T, N, ER, PR, HER2 };
}

// Survival statistics used by the app. Mirrors gdclens/surv.py and gdclens/cox.py (parity-tested).

const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const upperBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };

export class KM {
  constructor(t, S, nRisk, d, gw) { this.t = t; this.S = S; this.nRisk = nRisk; this.d = d; this.gw = gw; }
  at(x) { const i = upperBound(this.t, x); return i ? this.S[i - 1] : 1; }
  left(x) { const i = lowerBound(this.t, x); return i ? this.S[i - 1] : 1; }
  variance(x) { const i = upperBound(this.t, x); return i ? this.at(x) ** 2 * this.gw[i - 1] : 0; }
  median() { const i = this.S.findIndex(v => v <= 0.5); return i < 0 ? NaN : this.t[i]; }
}

export function km(time, event) {
  const n = time.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => time[a] - time[b] || a - b);
  const t = [], S = [], nr = [], dd = [], gw = [];
  let s = 1, g = 0, i = 0;
  while (i < n) {
    const tt = time[idx[i]];
    let j = i, d = 0;
    while (j < n && time[idx[j]] === tt) { d += event[idx[j]]; j++; }
    const atRisk = n - i;
    if (d > 0) {
      s *= 1 - d / atRisk;
      if (atRisk > d) g += d / (atRisk * (atRisk - d));
      t.push(tt); S.push(s); nr.push(atRisk); dd.push(d); gw.push(g);
    }
    i = j;
  }
  return new KM(t, S, nr, dd, gw);
}

export const reverseKM = (time, event) => km(time, event.map(e => 1 - e));
export const medianFollowup = (time, event) => reverseKM(time, event).median();
export const riskKM = (time, event, h) => 1 - km(time, event).at(h);

export function ipcwWeights(time, event, h, G, floor = 1e-6) {
  const gh = Math.max(G.at(h), floor);
  return time.map((t, i) => (t <= h && event[i] === 1) ? 1 / Math.max(G.left(t), floor) : (t > h ? 1 / gh : 0));
}

export function brier(time, event, risk, h, G = reverseKM(time, event)) {
  const w = ipcwWeights(time, event, h, G);
  const n = time.length;
  const y = time.map((t, i) => (t <= h && event[i] === 1) ? 1 : 0);
  const p0 = riskKM(time, event, h);
  let b = 0, b0 = 0;
  for (let i = 0; i < n; i++) { b += w[i] * (y[i] - risk[i]) ** 2; b0 += w[i] * (y[i] - p0) ** 2; }
  b /= n; b0 /= n;
  return { brier: b, null: b0, skill: b0 > 0 ? 1 - b / b0 : NaN };
}

export function unoC(time, event, risk, tau, G = reverseKM(time, event)) {
  const n = time.length;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    if (event[i] !== 1 || time[i] > tau) continue;
    const wi = 1 / Math.max(G.left(time[i]), 1e-6) ** 2;
    for (let j = 0; j < n; j++) {
      if (time[j] > time[i]) {
        den += wi;
        num += wi * (risk[i] > risk[j] ? 1 : risk[i] === risk[j] ? 0.5 : 0);
      }
    }
  }
  return den ? num / den : NaN;
}

// Same estimate as unoC in O(n log n): sweep from the longest follow-up down and keep risks of later patients in a Fenwick tree.
export function unoCFast(time, event, risk, tau, G = reverseKM(time, event)) {
  const n = time.length;
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => time[a] - time[b]);
  const uniq = Array.from(new Set(risk)).sort((a, b) => a - b);
  const rank = new Map(uniq.map((v, i) => [v, i + 1]));
  const m = uniq.length, bit = new Float64Array(m + 1);
  const add = r => { for (; r <= m; r += r & -r) bit[r] += 1; };
  const pre = r => { let s = 0; for (; r > 0; r -= r & -r) s += bit[r]; return s; };
  let num = 0, den = 0, total = 0, i = n - 1;
  while (i >= 0) {
    const t = time[ord[i]];
    let j = i;
    while (j >= 0 && time[ord[j]] === t) j--;
    if (t <= tau && total > 0) {
      const w = 1 / Math.max(G.left(t), 1e-6) ** 2;
      for (let k = j + 1; k <= i; k++) {
        const a = ord[k];
        if (event[a] !== 1) continue;
        const r = rank.get(risk[a]), less = pre(r - 1), equal = pre(r) - less;
        den += w * total;
        num += w * (less + 0.5 * equal);
      }
    }
    for (let k = j + 1; k <= i; k++) { add(rank.get(risk[ord[k]])); total++; }
    i = j;
  }
  return den ? num / den : NaN;
}

export function tdAuc(time, event, risk, h, G = reverseKM(time, event)) {
  const cases = [], controls = [];
  time.forEach((t, i) => { if (t <= h && event[i] === 1) cases.push(i); else if (t > h) controls.push(risk[i]); });
  if (!cases.length || !controls.length) return NaN;
  controls.sort((a, b) => a - b);
  let num = 0, den = 0;
  for (const i of cases) {
    const w = 1 / Math.max(G.left(time[i]), 1e-6);
    const lo = lowerBound(controls, risk[i]), hi = upperBound(controls, risk[i]);
    num += w * (lo + 0.5 * (hi - lo));
    den += w;
  }
  return num / (den * controls.length);
}

export function calibrationInTheLarge(time, event, risk, h) {
  const f = km(time, event);
  const obs = 1 - f.at(h), se = Math.sqrt(f.variance(h));
  const exp = risk.reduce((a, b) => a + b, 0) / risk.length;
  return { obs, exp, oe: obs / exp, se, seLogOE: obs > 0 ? se / obs : NaN, diff: exp - obs };
}

// ---- Poisson-exact interval for kappa = observed / expected deaths
function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 1000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
export function chi2ppf(p, df) {
  const a = df / 2;
  let lo = 0, hi = Math.max(10, df * 4);
  while (gammaP(a, hi / 2) < p) hi *= 2;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (gammaP(a, m / 2) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export const stepLookup = (ts, Hs, x) => { const i = upperBound(ts, x); return i ? Hs[i - 1] : 0; };

// lp: linear predictors of the local patients; baseline: {t, H} step function of the pooled model.
export function kappa(baseT, baseH, lp, time, event, horizon = null, level = 0.95) {
  let t = time, e = event;
  if (horizon !== null) { e = time.map((v, i) => (v <= horizon ? event[i] : 0)); t = time.map(v => Math.min(v, horizon)); }
  let E = 0, O = 0;
  for (let i = 0; i < t.length; i++) { E += stepLookup(baseT, baseH, t[i]) * Math.exp(lp[i]); O += e[i]; }
  const a = 1 - level;
  const lo = O > 0 ? chi2ppf(a / 2, 2 * O) / (2 * E) : 0;
  const hi = chi2ppf(1 - a / 2, 2 * (O + 1)) / (2 * E);
  return { kappa: E > 0 ? O / E : NaN, lo, hi, observed: O, expected: E };
}

// ---- label-bias estimators and simulation
export function labelEstimators(time, event, h) {
  const n = time.length;
  let dead = 0, known = 0;
  time.forEach((t, i) => { const d = t <= h && event[i] === 1; if (d) dead++; if (d || t > h) known++; });
  const G = reverseKM(time, event);
  const w = ipcwWeights(time, event, h, G);
  let s = 0;
  time.forEach((t, i) => { if (t <= h && event[i] === 1) s += w[i]; });
  return { naive: dead / n, drop: known ? dead / known : NaN, km: riskKM(time, event, h), ipcw: s / n, unknown: 1 - known / n, nKnown: known };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function simulateOnce(rng, n, shape, riskH, h, L, loss = 0) {
  const scale = h / Math.pow(-Math.log(1 - riskH), 1 / shape);
  const time = new Array(n), event = new Array(n);
  for (let i = 0; i < n; i++) {
    const T = scale * Math.pow(-Math.log(1 - rng()), 1 / shape);
    let C = rng() * L;
    if (loss > 0) C = Math.min(C, -Math.log(1 - rng()) / loss);
    time[i] = Math.min(T, C); event[i] = T <= C ? 1 : 0;
  }
  return { time, event };
}

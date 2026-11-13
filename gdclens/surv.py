"""Censoring-aware survival evaluation: Kaplan-Meier, inverse-probability-of-censoring weights,
concordance, Brier score, time-dependent AUC, calibration and net benefit."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import cox
from .basis import rcs


@dataclass
class KM:
    t: np.ndarray       # distinct event times
    S: np.ndarray       # S(t) just after each time
    n_risk: np.ndarray
    d: np.ndarray
    gw: np.ndarray      # cumulative Greenwood sum

    def at(self, x):
        """S(x), right-continuous."""
        x = np.atleast_1d(np.asarray(x, float))
        i = np.searchsorted(self.t, x, side="right")
        return np.concatenate([[1.0], self.S])[i]

    def left(self, x):
        """S(x-), the value just before x."""
        x = np.atleast_1d(np.asarray(x, float))
        i = np.searchsorted(self.t, x, side="left")
        return np.concatenate([[1.0], self.S])[i]

    def var_at(self, x):
        x = np.atleast_1d(np.asarray(x, float))
        i = np.searchsorted(self.t, x, side="right")
        return self.at(x) ** 2 * np.concatenate([[0.0], self.gw])[i]

    def median(self):
        below = np.flatnonzero(self.S <= 0.5)
        return float(self.t[below[0]]) if len(below) else float("nan")


def km(time, event) -> KM:
    time = np.asarray(time, float)
    event = np.asarray(event, float)
    order = np.argsort(time, kind="mergesort")
    t, e = time[order], event[order]
    ut, first = np.unique(t, return_index=True)
    n_at = len(t) - first
    d = np.add.reduceat(e, first)
    keep = d > 0
    n_at, d, ut = n_at[keep], d[keep], ut[keep]
    S = np.cumprod(1 - d / n_at)
    with np.errstate(divide="ignore", invalid="ignore"):
        gw = np.cumsum(np.where(n_at > d, d / (n_at * (n_at - d)), 0.0))
    return KM(ut, S, n_at, d, gw)


def reverse_km(time, event) -> KM:
    """Censoring distribution G(t) = P(C > t)."""
    return km(time, 1 - np.asarray(event, float))


def median_followup(time, event):
    return reverse_km(time, event).median()


def risk_km(time, event, h):
    return float(1 - km(time, event).at(h)[0])


def ipcw_weights(time, event, h, G: KM, floor=1e-6):
    """Graf weights: 1/G(T-) for deaths by h, 1/G(h) for those still event-free at h, 0 for censored before h."""
    time = np.asarray(time, float)
    event = np.asarray(event, float)
    w = np.zeros(len(time))
    dead = (time <= h) & (event == 1)
    w[dead] = 1.0 / np.maximum(G.left(time[dead]), floor)
    w[time > h] = 1.0 / max(float(G.at(h)[0]), floor)
    return w


def harrell_c(time, event, risk):
    time, event, risk = (np.asarray(a, float) for a in (time, event, risk))
    num = den = 0.0
    for i in np.flatnonzero(event == 1):
        later = time > time[i]
        den += later.sum()
        num += (risk[i] > risk[later]).sum() + 0.5 * (risk[i] == risk[later]).sum()
    return float(num / den) if den else float("nan")


def uno_c(time, event, risk, tau, G: KM | None = None):
    """Uno's censoring-weighted concordance, truncated at tau."""
    time, event, risk = (np.asarray(a, float) for a in (time, event, risk))
    G = G or reverse_km(time, event)
    idx = np.flatnonzero((event == 1) & (time <= tau))
    w = 1.0 / np.maximum(G.left(time[idx]), 1e-6) ** 2
    num = den = 0.0
    for wi, i in zip(w, idx):
        later = time > time[i]
        k = later.sum()
        if not k:
            continue
        den += wi * k
        num += wi * ((risk[i] > risk[later]).sum() + 0.5 * (risk[i] == risk[later]).sum())
    return float(num / den) if den else float("nan")


def brier(time, event, risk, h, G: KM | None = None):
    """IPCW Brier score at horizon h and the null (Kaplan-Meier) reference."""
    time, event, risk = (np.asarray(a, float) for a in (time, event, risk))
    G = G or reverse_km(time, event)
    w = ipcw_weights(time, event, h, G)
    y = ((time <= h) & (event == 1)).astype(float)
    b = float(np.mean(w * (y - risk) ** 2))
    p0 = risk_km(time, event, h)
    b0 = float(np.mean(w * (y - p0) ** 2))
    return dict(brier=b, null=b0, skill=1 - b / b0 if b0 > 0 else float("nan"))


def td_auc(time, event, risk, h, G: KM | None = None):
    """Cumulative/dynamic AUC at h: deaths by h versus those event-free at h, deaths weighted by 1/G(T-)."""
    time, event, risk = (np.asarray(a, float) for a in (time, event, risk))
    G = G or reverse_km(time, event)
    cases = np.flatnonzero((time <= h) & (event == 1))
    controls = risk[time > h]
    if not len(cases) or not len(controls):
        return float("nan")
    w = 1.0 / np.maximum(G.left(time[cases]), 1e-6)
    cs = np.sort(controls)
    lo = np.searchsorted(cs, risk[cases], side="left")
    hi = np.searchsorted(cs, risk[cases], side="right")
    conc = lo + 0.5 * (hi - lo)
    return float(np.sum(w * conc) / (np.sum(w) * len(controls)))


def calibration_in_the_large(time, event, risk, h):
    """Observed (Kaplan-Meier) versus mean predicted risk at h, with the Greenwood standard error."""
    f = km(time, event)
    obs = float(1 - f.at(h)[0])
    se = float(np.sqrt(f.var_at(h)[0]))
    exp = float(np.mean(risk))
    se_log = se / obs if obs > 0 else float("nan")
    return dict(obs=obs, exp=exp, oe=obs / exp if exp > 0 else float("nan"), se_obs=se, se_log_oe=se_log,
                diff=exp - obs)


def calibration_slope(time, event, lp):
    m = cox.fit(np.asarray(lp, float)[:, None], time, event)
    return float(m.beta[0]), float(m.se[0])


def ici(time, event, risk, h, knots=3):
    """Integrated calibration index (Austin 2020): mean |predicted - smoothed observed| risk at h."""
    risk = np.clip(np.asarray(risk, float), 1e-6, 1 - 1e-6)
    cll = np.log(-np.log(1 - risk))
    kn = np.quantile(cll, [0.1, 0.5, 0.9]) if knots == 3 else np.quantile(cll, np.linspace(0.05, 0.95, knots))
    B = rcs(cll, kn)
    m = cox.fit(B, time, event)
    cal = m.risk(B, h)
    err = np.abs(risk - cal)
    return dict(ici=float(err.mean()), e50=float(np.median(err)), e90=float(np.quantile(err, 0.9)),
                emax=float(err.max()))


def net_benefit(time, event, risk, h, thresholds):
    """Survival decision-curve net benefit with Kaplan-Meier event rates among those above threshold."""
    time, event, risk = (np.asarray(a, float) for a in (time, event, risk))
    n = len(time)
    out_model, out_all = [], []
    prev = risk_km(time, event, h)
    for pt in thresholds:
        hi = risk >= pt
        k = hi.sum()
        if k:
            p_hi = 1 - km(time[hi], event[hi]).at(h)[0]
            tp, fp = p_hi * k, (1 - p_hi) * k
        else:
            tp = fp = 0.0
        odds = pt / (1 - pt)
        out_model.append(tp / n - fp / n * odds)
        out_all.append(prev - (1 - prev) * odds)
    return np.array(out_model), np.array(out_all)


def boot_se(fn, arrays, B=200, seed=0):
    """Bootstrap standard error of fn(*arrays) (scalar or vector), resampling patients."""
    rng = np.random.default_rng(seed)
    n = len(arrays[0])
    vals = []
    for _ in range(B):
        i = rng.integers(0, n, n)
        try:
            v = fn(*[a[i] for a in arrays])
        except Exception:
            continue
        vals.append(v)
    vals = np.array(vals, float)
    return np.nanstd(vals, axis=0, ddof=1)

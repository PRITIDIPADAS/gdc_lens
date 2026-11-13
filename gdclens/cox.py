"""Cox proportional-hazards model: Newton-Raphson, Breslow ties and baseline, optional sign constraints.

Written from scratch (numpy only) so the identical arithmetic can be re-run in the browser.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.stats import chi2


@dataclass
class CoxModel:
    beta: np.ndarray
    mean: np.ndarray
    base_t: np.ndarray            # unique event times
    base_H: np.ndarray            # cumulative baseline hazard at those times (Breslow)
    se: np.ndarray = field(default_factory=lambda: np.array([]))
    loglik: float = float("nan")
    n: int = 0
    n_events: int = 0
    fixed_zero: tuple = ()

    def lp(self, X):
        return (np.asarray(X, float) - self.mean) @ self.beta

    def H0(self, t):
        t = np.atleast_1d(np.asarray(t, float))
        idx = np.searchsorted(self.base_t, t, side="right")
        H = np.concatenate([[0.0], self.base_H])
        return H[idx]

    def risk(self, X, h, kappa=1.0):
        """P(death by h | X) = 1 - exp(-kappa * H0(h) * exp(lp))."""
        return 1.0 - np.exp(-kappa * self.H0(h)[0] * np.exp(self.lp(X)))

    def survival_matrix(self, X, times):
        lp = self.lp(X)
        H = self.H0(times)
        return np.exp(-np.outer(np.exp(lp), H))


def _sorted(time, event, *arrays):
    order = np.argsort(time, kind="mergesort")
    t = np.asarray(time, float)[order]
    e = np.asarray(event, float)[order]
    first = np.searchsorted(t, t, side="left")  # first index sharing the same time
    return order, t, e, first, [a[order] for a in arrays]


def _rev_cumsum(a):
    return np.cumsum(a[::-1], axis=0)[::-1]


def _score_info(beta, Xc, off, e, first, want_info=True):
    eta = Xc @ beta + off
    eta = eta - eta.max()
    w = np.exp(eta)
    S0 = _rev_cumsum(w)[first]
    S1 = _rev_cumsum(w[:, None] * Xc)[first]
    ev = e == 1
    mu = S1[ev] / S0[ev][:, None]
    ll = float(np.sum(eta[ev] - np.log(S0[ev])))
    grad = (Xc[ev] - mu).sum(0)
    if not want_info:
        return ll, grad, None
    p = Xc.shape[1]
    S2 = _rev_cumsum(w[:, None] * (Xc[:, :, None] * Xc[:, None, :]).reshape(len(w), -1))[first][ev]
    info = (S2 / S0[ev][:, None]).sum(0).reshape(p, p) - mu.T @ mu
    return ll, grad, info


def _newton(Xc, off, e, first, l2, tol=1e-9, maxit=60):
    p = Xc.shape[1]
    beta = np.zeros(p)
    if p == 0:
        ll, _, _ = _score_info(beta, Xc, off, e, first, want_info=False)
        return beta, ll, np.zeros((0, 0))
    pen = lambda b: 0.5 * l2 * float(b @ b)
    ll, grad, info = _score_info(beta, Xc, off, e, first)
    obj = ll - pen(beta)
    for _ in range(maxit):
        g = grad - l2 * beta
        H = info + l2 * np.eye(p)
        try:
            step = np.linalg.solve(H, g)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(H, g, rcond=None)[0]
        scale = 1.0
        while True:
            nb = beta + scale * step
            nll, ngrad, ninfo = _score_info(nb, Xc, off, e, first)
            nobj = nll - pen(nb)
            if nobj >= obj - 1e-12 or scale < 1e-6:
                break
            scale *= 0.5
        done = abs(nobj - obj) < tol * (1 + abs(obj))
        beta, ll, grad, info, obj = nb, nll, ngrad, ninfo, nobj
        if done:
            break
    return beta, ll, info + l2 * np.eye(p)


def fit(X, time, event, offset=None, nonneg=(), l2=1e-8) -> CoxModel:
    """Fit a Cox model. `nonneg` lists columns whose coefficients must be >= 0 (active-set refits)."""
    X = np.asarray(X, float)
    n, p = X.shape
    off = np.zeros(n) if offset is None else np.asarray(offset, float)
    mean = X.mean(0)
    order, t, e, first, (Xs, offs) = _sorted(time, event, X - mean, off)
    usable = [j for j in range(p) if Xs[:, j].std() > 1e-12]
    nonneg = set(nonneg)
    fixed = set()
    beta = np.zeros(p)
    info_full = np.zeros((p, p))
    ll = float("nan")
    for _ in range(2 * p + 3):
        cols = [j for j in usable if j not in fixed]
        b, ll, info = _newton(Xs[:, cols], offs, e, first, l2)
        beta = np.zeros(p)
        beta[cols] = b
        info_full = np.zeros((p, p))
        info_full[np.ix_(cols, cols)] = info
        neg = [j for j in cols if j in nonneg and beta[j] < -1e-9]
        if neg:
            fixed.add(min(neg, key=lambda j: beta[j]))
            continue
        if fixed:  # release a fixed column if the constraint is not binding (KKT)
            _, grad, _ = _score_info(beta, Xs, offs, e, first, want_info=False)
            release = [j for j in fixed if grad[j] > 1e-7]
            if release:
                fixed.discard(max(release, key=lambda j: grad[j]))
                continue
        break
    cols = [j for j in usable if j not in fixed]
    se = np.full(p, np.nan)
    if cols:
        try:
            se[cols] = np.sqrt(np.diag(np.linalg.inv(info_full[np.ix_(cols, cols)])))
        except np.linalg.LinAlgError:
            pass
    w = np.exp(Xs @ beta + offs - (Xs @ beta + offs).max())
    S0 = _rev_cumsum(w)[first]
    ev = e == 1
    if not ev.any():
        return CoxModel(beta=beta, mean=mean, base_t=np.array([]), base_H=np.array([]), se=se, loglik=ll, n=n,
                        n_events=0, fixed_zero=tuple(sorted(fixed)))
    ut, inv = np.unique(t[ev], return_inverse=True)
    d = np.bincount(inv, minlength=len(ut)).astype(float)
    s0 = S0[ev][np.concatenate([[0], np.flatnonzero(np.diff(inv)) + 1])]
    shift = (Xs @ beta + offs).max()
    H = np.cumsum(d / (s0 * np.exp(shift)))
    return CoxModel(beta=beta, mean=mean, base_t=ut, base_H=H, se=se, loglik=ll, n=n, n_events=int(ev.sum()),
                    fixed_zero=tuple(sorted(fixed)))


def kappa(model: CoxModel, X, time, event, horizon=None, level=0.95, lp=None):
    """Local recalibration factor kappa = observed / expected deaths (expected from the pooled baseline).

    With a horizon, follow-up is cut at that time. Exact (Garwood) interval for the Poisson mean ratio.
    """
    time = np.asarray(time, float)
    event = np.asarray(event, float)
    if horizon is not None:
        event = np.where(time <= horizon, event, 0.0)
        time = np.minimum(time, horizon)
    lp = model.lp(X) if lp is None else np.asarray(lp, float)
    E = float(np.sum(model.H0(time) * np.exp(lp)))
    O = float(event.sum())
    a = 1 - level
    lo = chi2.ppf(a / 2, 2 * O) / (2 * E) if O > 0 else 0.0
    hi = chi2.ppf(1 - a / 2, 2 * (O + 1)) / (2 * E)
    return dict(kappa=O / E if E > 0 else float("nan"), lo=lo, hi=hi, observed=O, expected=E)

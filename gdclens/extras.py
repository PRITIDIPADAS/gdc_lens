"""Exploratory analyses (labelled as such in the plan): estimation window, proportional-hazards check,
predictor ladder."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import cox, surv
from .basis import quantile_knots, rcs
from .data import SITES
from .models import AGE_PROBS, CoxSpec
from .transport import HORIZONS, horizon_ok, meta, tau_for, truncate


def window_sensitivity(d: pd.DataFrame, windows=(None, 60)):
    rows = []
    for s in SITES:
        tr, te = d[d.site != s].reset_index(drop=True), d[d.site == s].reset_index(drop=True)
        t, e = te.time.to_numpy(float), te.event.to_numpy(float)
        tau = tau_for(t, e)
        for w in windows:
            m = CoxSpec("clinical").fit(tr if w is None else truncate(tr, w))
            lp = m.lp(te)
            for h in (36, 60):
                if not horizon_ok(t, e, h):
                    continue
                p = m.risk(te, h)
                cal = surv.calibration_in_the_large(t, e, p, h)
                q = pd.qcut(pd.Series(p).rank(method="first"), 3, labels=False).to_numpy()
                low, high = q == 0, q == 2
                rows.append(dict(site=s, window="all follow-up" if w is None else f"{w} months", horizon=h,
                                 uno_c=surv.uno_c(t, e, lp, tau), auc=surv.td_auc(t, e, lp, h),
                                 skill=surv.brier(t, e, p, h)["skill"], oe=cal["oe"],
                                 low_pred=float(p[low].mean()), low_obs=surv.risk_km(t[low], e[low], h),
                                 high_pred=float(p[high].mean()), high_obs=surv.risk_km(t[high], e[high], h)))
    return pd.DataFrame(rows)


def _basic_design(d):
    return np.column_stack([d.age / 10, d["T"], d["N"], (d.ER == "neg"), (d.PR == "neg"), (d.HER2 == "pos")]).astype(float)


PH_TERMS = ["age (per 10 y)", "pT (per category)", "pN (per category)", "ER negative", "PR negative", "HER2 positive"]


def ph_check(d: pd.DataFrame, landmark=60):
    """Hazard ratios in the first `landmark` months versus among those alive at the landmark."""
    k = d[(d.ER != "unk") & (d.PR != "unk") & (d.HER2 != "unk")]
    early = truncate(k, landmark)
    late = k[k.time > landmark].copy()
    late["time"] = late["time"] - landmark
    fe = cox.fit(_basic_design(early), early.time, early.event)
    fl = cox.fit(_basic_design(late), late.time, late.event)
    rows = []
    for j, name in enumerate(PH_TERMS):
        diff = fl.beta[j] - fe.beta[j]
        se = float(np.hypot(fl.se[j], fe.se[j]))
        rows.append(dict(term=name, hr_early=np.exp(fe.beta[j]), early_lo=np.exp(fe.beta[j] - 1.96 * fe.se[j]),
                         early_hi=np.exp(fe.beta[j] + 1.96 * fe.se[j]), hr_late=np.exp(fl.beta[j]),
                         late_lo=np.exp(fl.beta[j] - 1.96 * fl.se[j]), late_hi=np.exp(fl.beta[j] + 1.96 * fl.se[j]),
                         ratio=np.exp(diff), z=diff / se, n_early=len(early), events_early=int(early.event.sum()),
                         n_late=len(late), events_late=int(late.event.sum())))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- METABRIC-only ladder and leakage demo
RUNGS = {
    "age + pT + pN": dict(rec=False, her2=False, grade=False, tx=False),
    "+ ER, PR": dict(rec=True, her2=False, grade=False, tx=False),
    "+ HER2": dict(rec=True, her2=True, grade=False, tx=False),
    "+ grade": dict(rec=True, her2=True, grade=True, tx=False),
}


def _ladder_X(d, knots, spec):
    cols = [rcs(d.age.to_numpy(float), knots)]
    T, N = d["T"].to_numpy(), d["N"].to_numpy()
    cols.append(np.column_stack([T >= 2, T >= 3, N >= 1, N >= 2, N >= 3]).astype(float))
    nonneg = list(range(3, 8))
    if spec["rec"]:
        cols.append(np.column_stack([d.ER == "neg", d.PR == "neg"]).astype(float))
    if spec["her2"]:
        cols.append((d.HER2 == "pos").to_numpy(float)[:, None])
    if spec["grade"]:
        g = d.grade.to_numpy(float)
        base = sum(c.shape[1] for c in cols)
        cols.append(np.column_stack([g >= 2, g >= 3]).astype(float))
        nonneg += [base, base + 1]
    if spec["tx"]:
        cols.append(d[["chemo", "hormone", "radio"]].to_numpy(float))
    return np.hstack(cols), nonneg


def ladder(d: pd.DataFrame, B=100, seed=0):
    m = d[(d.site != "TCGA") & d.grade.notna()].reset_index(drop=True)
    sites = [s for s in SITES if s != "TCGA"]
    rng = np.random.default_rng(seed)
    rows, boot = [], {}
    for s in sites:
        tr, te = m[m.site != s].reset_index(drop=True), m[m.site == s].reset_index(drop=True)
        t, e = te.time.to_numpy(float), te.event.to_numpy(float)
        tau = tau_for(t, e)
        knots = quantile_knots(tr.age, AGE_PROBS)
        idx = rng.integers(0, len(te), (B, len(te)))
        for name, spec in RUNGS.items():
            Xtr, nn = _ladder_X(tr, knots, spec)
            f = cox.fit(Xtr, tr.time, tr.event, nonneg=nn)
            lp = f.lp(_ladder_X(te, knots, spec)[0])
            cb = np.array([surv.uno_c(t[i], e[i], lp[i], tau) for i in idx])
            boot[(s, name)] = cb
            rows.append(dict(site=s, rung=name, uno_c=surv.uno_c(t, e, lp, tau), se=float(np.std(cb, ddof=1)), n=len(te)))
    tab = pd.DataFrame(rows)
    names = list(RUNGS)
    pooled = []
    for k, name in enumerate(names):
        r = meta(tab[tab.rung == name].uno_c.to_numpy(), tab[tab.rung == name].se.to_numpy())
        row = dict(rung=name, uno_c=r["est"], lo=r["lo"], hi=r["hi"])
        if k:
            prev = names[k - 1]
            ds, ses = [], []
            for s in sites:
                a = tab[(tab.site == s) & (tab.rung == name)].uno_c.iloc[0] - tab[(tab.site == s) & (tab.rung == prev)].uno_c.iloc[0]
                ds.append(a)
                ses.append(float(np.std(boot[(s, name)] - boot[(s, prev)], ddof=1)))
            dm = meta(ds, ses)
            row.update(delta=dm["est"], delta_lo=dm["lo"], delta_hi=dm["hi"])
        pooled.append(row)
    return tab, pd.DataFrame(pooled)


# ---------------------------------------------------------------- endpoint sensitivity
def endpoint_sensitivity(d: pd.DataFrame, B=200, seed=0):
    """Deployed model (fitted on overall survival at the other sites) scored on overall versus breast-cancer-specific
    death in the METABRIC sites; other-cause deaths are censored. TCGA carries no cause of death."""
    sites = [s for s in SITES if s != "TCGA"]
    rng = np.random.default_rng(seed)
    rows = []
    for s in sites:
        tr, te = d[d.site != s].reset_index(drop=True), d[(d.site == s) & d.cause.notna()].reset_index(drop=True)
        lp = CoxSpec("clinical").fit(tr).lp(te)
        t = te.time.to_numpy(float)
        idx = rng.integers(0, len(te), (B, len(te)))
        for name, e in (("overall survival", te.event.to_numpy(float)),
                        ("breast-cancer-specific", (te.cause == "breast").to_numpy(float))):
            tau = tau_for(t, e)
            cb = np.array([surv.uno_c(t[i], e[i], lp[i], tau) for i in idx])
            rows.append(dict(site=s, endpoint=name, n=len(te), deaths=int(e.sum()), uno_c=surv.uno_c(t, e, lp, tau),
                             se=float(np.std(cb, ddof=1))))
    tab = pd.DataFrame(rows)
    pooled = []
    for name in tab.endpoint.unique():
        g = tab[tab.endpoint == name]
        r = meta(g.uno_c.to_numpy(), g.se.to_numpy())
        pooled.append(dict(endpoint=name, deaths=int(g.deaths.sum()), uno_c=r["est"], lo=r["lo"], hi=r["hi"]))
    return tab, pd.DataFrame(pooled)

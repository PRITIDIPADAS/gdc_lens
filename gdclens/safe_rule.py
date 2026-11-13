"""Safe-to-reassure rule: a risk threshold chosen so that observed mortality below it is bounded."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import surv
from .models import make_model


def oof_risk(d: pd.DataFrame, h=36, kind="clinical") -> np.ndarray:
    """Risk for every patient from a model fitted on the other sites (what a new site would experience)."""
    out = np.full(len(d), np.nan)
    for s in d["site"].unique():
        m = make_model(kind).fit(d[d.site != s])
        mask = (d["site"] == s).to_numpy()
        out[mask] = m.risk(d[mask], h)
    return out


def km_upper(time, event, h, z=1.645):
    f = surv.km(time, event)
    r = float(1 - f.at(h)[0])
    se = float(np.sqrt(f.var_at(h)[0]))
    return r, se, r + z * se


def choose_lambda(risk, time, event, h=36, alpha=0.05, min_n=250, step=10, z=1.645):
    """Largest threshold such that the upper 95% limit of Kaplan-Meier mortality in the set at or below it is <= alpha.
    First-violation rule over the sorted risks; returns None when even the smallest admissible set fails."""
    risk, time, event = (np.asarray(a, float) for a in (risk, time, event))
    order = np.argsort(risk, kind="mergesort")
    r, t, e = risk[order], time[order], event[order]
    best = None
    for k in range(min_n, len(r) + 1, step):
        k_eff = k
        while k_eff < len(r) and r[k_eff] == r[k_eff - 1]:  # keep ties together
            k_eff += 1
        _, _, ub = km_upper(t[:k_eff], e[:k_eff], h, z)
        if ub > alpha:
            break
        best = float(r[k_eff - 1])
    return best


def evaluate(risk, time, event, lam, h=36, z=1.96):
    risk, time, event = (np.asarray(a, float) for a in (risk, time, event))
    if lam is None:
        return dict(lam=np.nan, coverage=0.0, n=0, deaths=0, km=np.nan, lo=np.nan, hi=np.nan)
    m = risk <= lam
    if m.sum() < 5:
        return dict(lam=lam, coverage=float(m.mean()), n=int(m.sum()), deaths=int(event[m].sum()), km=np.nan,
                    lo=np.nan, hi=np.nan)
    r, se, _ = km_upper(time[m], event[m], h)
    return dict(lam=lam, coverage=float(m.mean()), n=int(m.sum()), deaths=int(((time <= h) & (event == 1) & m).sum()),
                km=r, lo=max(0.0, r - z * se), hi=r + z * se)

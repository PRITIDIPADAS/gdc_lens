"""Label-bias audit: how binary 'dead / alive' targets distort mortality estimates when follow-up is incomplete."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import surv


def estimators(time, event, h):
    """h-month mortality under four labelling rules.

    naive  censored-as-alive: death by h among everyone
    drop   discard patients censored before h (status at h unknown)
    km     Kaplan-Meier (consistent when censoring is independent of outcome)
    ipcw   inverse-probability-of-censoring weighted proportion
    """
    time = np.asarray(time, float)
    event = np.asarray(event, float)
    dead = (time <= h) & (event == 1)
    known = dead | (time > h)
    G = surv.reverse_km(time, event)
    w = surv.ipcw_weights(time, event, h, G)
    return dict(naive=float(dead.mean()),
                drop=float(dead.sum() / known.sum()) if known.any() else float("nan"),
                km=surv.risk_km(time, event, h),
                ipcw=float(np.mean(w * dead)),
                unknown=float(1 - known.mean()), n_known=int(known.sum()))


def audit_table(d: pd.DataFrame, groups: dict, horizons=(36, 60, 120), B=1000, seed=0, min_known=30):
    """Per group and horizon: the four estimates, bias of naive/drop versus KM, bootstrap intervals."""
    rng = np.random.default_rng(seed)
    rows = []
    for name, idx in groups.items():
        t, e = d.loc[idx, "time"].to_numpy(float), d.loc[idx, "event"].to_numpy(float)
        for h in horizons:
            est = estimators(t, e, h)
            if est["n_known"] < min_known or t.max() < h:
                continue
            boots = []
            for _ in range(B):
                i = rng.integers(0, len(t), len(t))
                b = estimators(t[i], e[i], h)
                boots.append((b["naive"] - b["km"], b["drop"] - b["km"], b["km"]))
            boots = np.array(boots)
            lo, hi = np.nanpercentile(boots, [2.5, 97.5], axis=0)
            rows.append(dict(group=name, horizon=h, n=len(t), deaths=int(e.sum()),
                             followup_median=float(surv.median_followup(t, e)),
                             unknown_status=est["unknown"], km=est["km"], ipcw=est["ipcw"], naive=est["naive"],
                             drop=est["drop"], bias_naive=est["naive"] - est["km"], bias_naive_lo=lo[0],
                             bias_naive_hi=hi[0], bias_drop=est["drop"] - est["km"], bias_drop_lo=lo[1],
                             bias_drop_hi=hi[1], km_lo=lo[2], km_hi=hi[2]))
    return pd.DataFrame(rows)


def simulate_once(rng, n, shape, risk_h, h, L, loss=0.0):
    """Weibull event times with exact h-month mortality `risk_h`; uniform(0, L) administrative censoring
    (L = longest possible follow-up) plus optional exponential loss to follow-up (rate per month)."""
    scale = h / (-np.log(1 - risk_h)) ** (1 / shape)
    T = scale * rng.weibull(shape, n)
    C = rng.uniform(0, L, n)
    if loss > 0:
        C = np.minimum(C, rng.exponential(1 / loss, n))
    return np.minimum(T, C), (T <= C).astype(float)


def simulation_grid(shapes=(0.8, 1.0, 1.5), risks=(0.05, 0.10, 0.20), Ls=(24, 36, 48, 60, 90, 120, 180, 240),
                    h=36, n=1000, reps=200, seed=1):
    rng = np.random.default_rng(seed)
    out = []
    for shape in shapes:
        for risk in risks:
            for L in Ls:
                acc = {k: [] for k in ("naive", "drop", "km", "ipcw", "mfu")}
                for _ in range(reps):
                    t, e = simulate_once(rng, n, shape, risk, h, L)
                    est = estimators(t, e, h)
                    for k in ("naive", "drop", "km", "ipcw"):
                        acc[k].append(est[k])
                    acc["mfu"].append(surv.median_followup(t, e))
                out.append(dict(shape=shape, true_risk=risk, L=L, followup_median=float(np.nanmedian(acc["mfu"])),
                                **{f"{k}_mean": float(np.nanmean(acc[k])) for k in ("naive", "drop", "km", "ipcw")},
                                **{f"{k}_sd": float(np.nanstd(acc[k])) for k in ("naive", "drop", "km", "ipcw")}))
    return pd.DataFrame(out)


def ranking_check(models: dict, d: pd.DataFrame, h=36):
    """Do model comparisons survive the label choice? AUC against naive binary labels vs censoring-weighted AUC."""
    from sklearn.metrics import roc_auc_score
    t, e = d["time"].to_numpy(float), d["event"].to_numpy(float)
    y_naive = ((t <= h) & (e == 1)).astype(int)
    keep = ((t <= h) & (e == 1)) | (t > h)
    rows = []
    for name, r in models.items():
        r = np.asarray(r, float)
        rows.append(dict(model=name, auc_naive=roc_auc_score(y_naive, r),
                         auc_drop=roc_auc_score(y_naive[keep], r[keep]), auc_ipcw=surv.td_auc(t, e, r, h)))
    return pd.DataFrame(rows)

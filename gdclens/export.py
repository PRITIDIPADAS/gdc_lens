"""Serialise the deployed model, its lookup table and the result tables for the web app."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import audit, models as M, passport as P, safe_rule as S

ALPHAS = (0.05, 0.075, 0.10)
LIGHT_CODE = {"G": 0, "A": 1, "R": 2}


def _r(a, k):
    return np.round(np.asarray(a, float), k).tolist()


def model_json(spec: M.CoxSpec, d: pd.DataFrame, name: str, trained_on: list) -> dict:
    m = spec.model
    prev = {}
    for r in M.RECEPTORS:
        known = d[d[r] != "unk"][r]
        prev[r] = {"pos": float((known == "pos").mean()), "neg": float((known == "neg").mean())}
    return dict(
        name=name, version="1.0.0", trained_on=trained_on, n=int(len(d)), deaths=int(d.event.sum()),
        terms=spec.names, beta=_r(m.beta, 10), se=[None if not np.isfinite(x) else round(float(x), 6) for x in m.se],
        mean=_r(m.mean, 10), age_table=_r(spec.age_table, 10), age_raw=_r(spec.age_raw, 10),
        age_mean=round(spec.age_mean, 10), age_knots=_r(spec.knots, 6), age_from=M.AGE_RANGE[0],
        base_t=_r(m.base_t, 4), base_H=_r(m.base_H, 10), receptor_prevalence=prev,
        reference=audit.REF, horizons=[36, 60, 120],
    )


def grid_json(model: M.CoxSpec, d: pd.DataFrame, B=300, seed=0) -> tuple[dict, dict]:
    grid = M.profile_grid()
    flags, summary, risk, _ = audit.audit(model, grid)
    oof36 = S.oof_risk(d, 36)
    pp = P.passport(d, grid, B=B, seed=seed, oof=oof36, grid_flags=flags)
    lights = np.zeros(len(pp), int)
    for k, c in enumerate(P.COMPONENTS):
        lights += pp[f"light_{c}"].map(LIGHT_CODE).to_numpy() * 3 ** k
    verdict = pp["verdict"].map({v: i for i, v in enumerate(P.VERDICTS)}).to_numpy()
    nz = lambda x, k: [None if not np.isfinite(v) else round(float(v), k) for v in x]
    g = dict(
        n=len(grid), risk36=_r(risk[36], 6), risk60=_r(risk[60], 6), risk120=_r(risk[120], 6),
        lo36=_r(pp.risk_lo, 5), hi36=_r(pp.risk_hi, 5), support=pp.support_n.astype(int).tolist(),
        stability=_r(pp.stability_sd, 4), local_n=pp.local_n.astype(int).tolist(),
        local_pred=nz(pp.local_pred, 4), local_obs=nz(pp.local_obs, 4), local_z=nz(pp.local_z, 2),
        lights=lights.tolist(), verdict=verdict.tolist(),
        rules_pass=flags["rules_pass"].astype(int).tolist(), unk_advisory=flags["unknown_advisory"].astype(int).tolist(),
        light_order=list(P.COMPONENTS), verdict_labels=list(P.VERDICTS),
    )
    return g, summary


def rule_json(oof: np.ndarray, d: pd.DataFrame) -> dict:
    out = {}
    for a in ALPHAS:
        lam = S.choose_lambda(oof, d.time, d.event, alpha=a)
        ev = S.evaluate(oof, d.time, d.event, lam)
        out[str(a)] = dict(alpha=a, lam=None if lam is None else round(lam, 6),
                           coverage=None if lam is None else round(ev["coverage"], 4),
                           km=None if lam is None else round(ev["km"], 4),
                           lo=None if lam is None else round(ev["lo"], 4), hi=None if lam is None else round(ev["hi"], 4),
                           n=ev["n"], deaths=ev["deaths"])
    return out


def df_records(df: pd.DataFrame, k=5):
    return json.loads(df.round(k).to_json(orient="records"))


def calibration_bins(risk: np.ndarray, d: pd.DataFrame, h=36, per_site=4, pooled=8) -> dict:
    """Predicted versus Kaplan-Meier observed risk in quantile bins of out-of-fold predicted risk."""
    from . import surv

    def bins(mask, k):
        t, e, p = d.time.to_numpy(float)[mask], d.event.to_numpy(float)[mask], np.asarray(risk, float)[mask]
        q = pd.qcut(pd.Series(p).rank(method="first"), k, labels=False).to_numpy()
        out = []
        for j in range(k):
            m = q == j
            f = surv.km(t[m], e[m])
            obs, se = float(1 - f.at(h)[0]), float(np.sqrt(f.var_at(h)[0]))
            out.append(dict(n=int(m.sum()), pred=round(float(p[m].mean()), 5), obs=round(obs, 5),
                            lo=round(max(0.0, obs - 1.96 * se), 5), hi=round(min(1.0, obs + 1.96 * se), 5)))
        return out

    res = {"All held-out sites": bins(np.ones(len(d), bool), pooled)}
    for s in d["site"].unique():
        res[s] = bins((d["site"] == s).to_numpy(), per_site)
    return res


def decision_curves(risk: np.ndarray, d: pd.DataFrame, h=36, grid=None) -> dict:
    from . import surv

    pts = np.round(np.arange(0.01, 0.2501, 0.01), 3) if grid is None else np.asarray(grid)
    out = {"thresholds": pts.tolist()}
    for name, mask in [("All held-out sites", np.ones(len(d), bool))] + [(s, (d["site"] == s).to_numpy()) for s in d["site"].unique()]:
        nb, nb_all = surv.net_benefit(d.time.to_numpy(float)[mask], d.event.to_numpy(float)[mask], np.asarray(risk, float)[mask], h, pts)
        out[name] = dict(model=_r(nb, 5), all=_r(nb_all, 5))
    return out

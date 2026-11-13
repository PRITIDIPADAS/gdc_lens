"""Evidence passport: for one profile, how much data and stability stand behind the prediction."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import audit as audit_mod
from . import safe_rule, surv
from .models import INPUTS, CoxSpec, grid_index

VERDICTS = ("SHOW", "SHOW WITH CAUTION", "ABSTAIN")
COMPONENTS = ("support", "stability", "precision", "local", "rules")
REF_ROW = pd.DataFrame([audit_mod.REF])


@dataclass(frozen=True)
class Thresholds:
    support: tuple = (30, 10)        # green >=, red <
    stability: tuple = (0.15, 0.30)  # green <=, red >
    precision: tuple = (0.10, 0.20)  # green <=, red >
    local_gap: tuple = (0.05, 0.10)  # green <=, red >
    local_z: tuple = (1.0, 2.0)
    min_local_n: int = 20
    window_support: float = 5.0
    window_local: float = 10.0


def _codes(df: pd.DataFrame) -> np.ndarray:
    lv = {"pos": 0, "neg": 1, "unk": 2}
    return ((((df["T"].to_numpy(int) - 1) * 4 + df["N"].to_numpy(int)) * 27)
            + df["ER"].map(lv).to_numpy(int) * 9 + df["PR"].map(lv).to_numpy(int) * 3 + df["HER2"].map(lv).to_numpy(int))


def similar_counts(train: pd.DataFrame, profiles: pd.DataFrame, window: float) -> np.ndarray:
    tc, ta = _codes(train), train["age"].to_numpy(float)
    by = {c: np.sort(ta[tc == c]) for c in np.unique(tc)}
    pc, pa = _codes(profiles), profiles["age"].to_numpy(float)
    out = np.zeros(len(profiles), int)
    for c in np.unique(pc):
        m = pc == c
        arr = by.get(c, np.array([]))
        out[m] = np.searchsorted(arr, pa[m] + window, side="right") - np.searchsorted(arr, pa[m] - window, side="left")
    return out


def local_calibration(train: pd.DataFrame, oof: np.ndarray, profiles: pd.DataFrame, window: float, min_n: int, h=36):
    tc, ta = _codes(train), train["age"].to_numpy(float)
    tt, te = train["time"].to_numpy(float), train["event"].to_numpy(float)
    idx_by = {c: np.flatnonzero(tc == c) for c in np.unique(tc)}
    pc, pa = _codes(profiles), profiles["age"].to_numpy(float)
    n = len(profiles)
    cnt = np.zeros(n, int)
    pred, obs, z = (np.full(n, np.nan) for _ in range(3))
    cache = {}
    for i in range(n):
        key = (pc[i], round(pa[i], 1))
        if key not in cache:
            ix = idx_by.get(pc[i], np.array([], int))
            sel = ix[np.abs(ta[ix] - pa[i]) <= window]
            if len(sel) < min_n:
                cache[key] = (len(sel), np.nan, np.nan, np.nan)
            else:
                r, se, _ = safe_rule.km_upper(tt[sel], te[sel], h)
                pb = float(np.mean(oof[sel]))
                se = max(se, float(np.sqrt(pb * (1 - pb) / len(sel))))
                cache[key] = (len(sel), pb, r, (pb - r) / se)
        cnt[i], pred[i], obs[i], z[i] = cache[key]
    return cnt, pred, obs, z


def stability_sd(train: pd.DataFrame, profiles: pd.DataFrame) -> np.ndarray:
    """SD across leave-one-site-out refits of the profile's log hazard ratio against the reference profile."""
    out = []
    for s in sorted(train["site"].unique()):
        m = CoxSpec("clinical").fit(train[train.site != s])
        out.append(m.lp(profiles) - float(m.lp(REF_ROW)[0]))
    return np.std(np.array(out), axis=0, ddof=1)


def bootstrap_risk(train: pd.DataFrame, profiles: pd.DataFrame, B: int, seed: int, h=36):
    rng = np.random.default_rng(seed)
    n = len(train)
    out = np.empty((B, len(profiles)))
    for b in range(B):
        m = CoxSpec("clinical").fit(train.iloc[rng.integers(0, n, n)])
        out[b] = m.risk(profiles, h)
    q = np.quantile(out, [0.025, 0.975], axis=0)
    return q[0], q[1]


def _light_ge(x, green, red):  # larger is better
    return np.where(x >= green, "G", np.where(x < red, "R", "A"))


def _light_le(x, green, red):  # smaller is better
    return np.where(x <= green, "G", np.where(x > red, "R", "A"))


def passport(train: pd.DataFrame, profiles: pd.DataFrame, B=200, seed=0, th: Thresholds = Thresholds(), h=36,
             oof: np.ndarray | None = None, grid_flags: pd.DataFrame | None = None) -> pd.DataFrame:
    prof = profiles[INPUTS].reset_index(drop=True)
    model = CoxSpec("clinical").fit(train)
    risk = model.risk(prof, h)
    lo, hi = bootstrap_risk(train, prof, B, seed, h)
    sd = stability_sd(train, prof)
    n_sup = similar_counts(train, prof, th.window_support)
    oof = safe_rule.oof_risk(train, h) if oof is None else oof
    n_loc, p_loc, o_loc, z_loc = local_calibration(train, oof, prof, th.window_local, th.min_local_n, h)
    if grid_flags is None:
        grid_flags = audit_mod.audit(model)[0]
    rules_pass = grid_flags["rules_pass"].to_numpy()[grid_index(prof)]
    gap = np.abs(p_loc - o_loc)
    L = {"support": _light_ge(n_sup, *th.support), "stability": _light_le(sd, *th.stability),
         "precision": _light_le(hi - lo, *th.precision)}
    loc = np.full(len(prof), "A", dtype="<U1")
    ok = np.isfinite(gap)
    green = ok & ((gap <= th.local_gap[0]) | (np.abs(z_loc) <= th.local_z[0]))
    red = ok & (gap > th.local_gap[1]) & (np.abs(z_loc) > th.local_z[1])
    loc[green], loc[red] = "G", "R"
    L["local"] = loc
    L["rules"] = np.where(rules_pass, "G", "R")
    lights = pd.DataFrame(L)
    verdict = np.where((lights == "R").any(axis=1), "ABSTAIN", np.where((lights == "G").all(axis=1), "SHOW", "SHOW WITH CAUTION"))
    out = pd.DataFrame({"risk": risk, "risk_lo": lo, "risk_hi": hi, "support_n": n_sup, "stability_sd": sd,
                        "precision_w": hi - lo, "local_n": n_loc, "local_pred": p_loc, "local_obs": o_loc,
                        "local_gap": p_loc - o_loc, "local_z": z_loc, "rules_pass": rules_pass})
    for c in COMPONENTS:
        out[f"light_{c}"] = lights[c].to_numpy()
    out["verdict"] = verdict
    return out


# ------------------------------------------------------------------ validation in held-out sites
def group_calibration(p, time, event, verdict, h=36, min_n=20):
    rows = []
    for g in VERDICTS:
        m = np.asarray(verdict) == g
        if m.sum() < min_n:
            rows.append(dict(group=g, n=int(m.sum()), pred=np.nan, obs=np.nan, gap=np.nan, signed=np.nan))
            continue
        r, se, _ = safe_rule.km_upper(time[m], event[m], h)
        rows.append(dict(group=g, n=int(m.sum()), pred=float(p[m].mean()), obs=r, se=se,
                         gap=float(abs(p[m].mean() - r)), signed=float(p[m].mean() - r)))
    return pd.DataFrame(rows)


def _site_stat(p, t, e, v, which, h, min_n):
    m_a = v == which
    m_s = v == "SHOW"
    if m_a.sum() < min_n or m_s.sum() < min_n:
        return np.nan
    ga = abs(p[m_a].mean() - surv.risk_km(t[m_a], e[m_a], h))
    gs = abs(p[m_s].mean() - surv.risk_km(t[m_s], e[m_s], h))
    return ga - gs


def permutation_test(sites: dict, which: str, h=36, n_perm=1000, seed=0, min_n=20):
    """sites: {site: (p, time, event, verdict)}. Statistic: mean over sites of gap(which) - gap(SHOW).
    Null: verdicts shuffled within deciles of predicted risk inside each site."""
    rng = np.random.default_rng(seed)
    strata = {s: pd.qcut(pd.Series(v[0]).rank(method="first"), 10, labels=False).to_numpy() for s, v in sites.items()}

    def stat(perm):
        vals = []
        for s, (p, t, e, v) in sites.items():
            vv = v.copy()
            if perm:
                for k in range(10):
                    ix = np.flatnonzero(strata[s] == k)
                    vv[ix] = rng.permutation(v[ix])
            vals.append(_site_stat(p, t, e, vv, which, h, min_n))
        vals = np.array(vals)
        return np.nanmean(vals) if np.isfinite(vals).any() else np.nan, np.isfinite(vals).sum()

    obs, k = stat(False)
    if not np.isfinite(obs):
        return dict(stat=np.nan, p=np.nan, sites=0)
    null = np.array([stat(True)[0] for _ in range(n_perm)])
    return dict(stat=float(obs), p=float((1 + np.sum(null >= obs)) / (1 + n_perm)), sites=int(k),
                null_mean=float(np.nanmean(null)))


def validate_loco(d: pd.DataFrame, B=100, n_perm=1000, seed=0, h=36):
    per_patient, tables = [], []
    for si, s in enumerate(sorted(d["site"].unique())):
        tr, te = d[d.site != s].reset_index(drop=True), d[d.site == s].reset_index(drop=True)
        pp = passport(tr, te, B=B, seed=seed + si, h=h)
        pp.insert(0, "site", s)
        pp["time"], pp["event"] = te["time"].to_numpy(), te["event"].to_numpy()
        per_patient.append(pp)
        g = group_calibration(pp["risk"].to_numpy(), pp["time"].to_numpy(), pp["event"].to_numpy(), pp["verdict"].to_numpy(), h)
        g.insert(0, "site", s)
        tables.append(g)
    pp = pd.concat(per_patient, ignore_index=True)
    sites = {s: (g["risk"].to_numpy(), g["time"].to_numpy(float), g["event"].to_numpy(float), g["verdict"].to_numpy())
             for s, g in pp.groupby("site")}
    tests = {w: permutation_test(sites, w, h, n_perm, seed) for w in ("ABSTAIN", "SHOW WITH CAUTION")}
    return pp, pd.concat(tables, ignore_index=True), tests

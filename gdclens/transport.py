"""Leave-one-site-out validation, random-effects pooling and local recalibration."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from . import cox, surv
from .data import SITES
from .models import MODEL_IDS, CoxSpec, make_model

HORIZONS = (36, 60, 120)
MIN_G = 0.10


# ------------------------------------------------------------------ fitting
COX_IDS = ("stage", "age_stage", "clinical", "reduced")


def loco_run(d: pd.DataFrame, model_ids=MODEL_IDS, sites=SITES):
    """Fit every model on all other sites and predict the held-out site.
    Returns (cox_fits, preds): Cox fits are kept for later stages, forests are dropped after predicting."""
    fits, preds = {}, {}
    for s in sites:
        tr = d[d.site != s].reset_index(drop=True)
        te = d[d.site == s].reset_index(drop=True)
        pr = {}
        for m in model_ids:
            f = make_model(m).fit(tr)
            pr[m] = {"lp": f.lp(te), "risk": {h: f.risk(te, h) for h in HORIZONS}}
            if m in COX_IDS:
                fits[(s, m)] = f
            del f
        preds[s] = (te, pr)
    return fits, preds


def tau_for(t, e, cap=60.0):
    G = surv.reverse_km(t, e)
    ok = G.t[G.S >= MIN_G]
    return float(min(cap, ok.max() if len(ok) else cap))


def horizon_ok(t, e, h):
    G = surv.reverse_km(t, e)
    known = ((t <= h) & (e == 1)) | (t > h)
    return bool(G.at(h)[0] >= MIN_G and known.sum() >= 30 and (e[t <= h] == 1).sum() >= 5)


def truncate(d: pd.DataFrame, h: float) -> pd.DataFrame:
    """Administratively censor follow-up at h months (estimation-window sensitivity)."""
    d = d.copy()
    d["event"] = np.where(d["time"] <= h, d["event"], 0)
    d["time"] = np.minimum(d["time"], h)
    return d


# ------------------------------------------------------------------ site metrics
def site_eval(te: pd.DataFrame, preds: dict, horizons=HORIZONS, B=200, seed=0):
    """preds: {model: {"lp": array, "risk": {h: array}}}. Returns (rows, boot) with shared bootstrap resamples."""
    t, e = te["time"].to_numpy(float), te["event"].to_numpy(float)
    n = len(t)
    tau = tau_for(t, e)
    hs = [h for h in horizons if horizon_ok(t, e, h)]
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, (B, n))
    rows, boot = [], {}
    for m, p in preds.items():
        lp = np.asarray(p["lp"], float)
        c_b = np.array([surv.uno_c(t[i], e[i], lp[i], tau) for i in idx])
        boot[(m, "uno_c")] = c_b
        c = surv.uno_c(t, e, lp, tau)
        slope, slope_se = (np.nan, np.nan) if m == "rsf" else surv.calibration_slope(t, e, lp)  # forest score is not a log hazard
        for h in hs:
            r = np.asarray(p["risk"][h], float)
            a_b = np.array([surv.td_auc(t[i], e[i], lp[i], h) for i in idx])
            k_b = np.array([surv.brier(t[i], e[i], r[i], h)["skill"] for i in idx])
            boot[(m, f"auc{h}")] = a_b
            boot[(m, f"skill{h}")] = k_b
            br = surv.brier(t, e, r, h)
            cal = surv.calibration_in_the_large(t, e, r, h)
            rows.append(dict(model=m, horizon=h, n=n, deaths=int(e.sum()), tau=tau, uno_c=c,
                             uno_c_se=float(np.nanstd(c_b, ddof=1)), auc=surv.td_auc(t, e, lp, h),
                             auc_se=float(np.nanstd(a_b, ddof=1)), brier=br["brier"], brier_null=br["null"],
                             skill=br["skill"], skill_se=float(np.nanstd(k_b, ddof=1)), obs=cal["obs"],
                             exp=cal["exp"], oe=cal["oe"], ln_oe_se=cal["se_log_oe"], calib_diff=cal["diff"],
                             slope=slope, slope_se=slope_se, ici=surv.ici(t, e, r, h)["ici"] if h == 36 else np.nan))
    return pd.DataFrame(rows), boot


def loco_evaluate(preds: dict, B=200, seed=0):
    tables, boots = [], {}
    for si, s in enumerate(SITES):
        te, pr = preds[s]
        tab, boot = site_eval(te, pr, B=B, seed=seed + si)
        tab.insert(0, "site", s)
        tables.append(tab)
        boots[s] = boot
    return pd.concat(tables, ignore_index=True), boots


# ------------------------------------------------------------------ pooling
def meta(est, se, level=0.95):
    """DerSimonian-Laird random effects with Hartung-Knapp interval and a prediction interval."""
    est, se = np.asarray(est, float), np.asarray(se, float)
    ok = np.isfinite(est) & np.isfinite(se) & (se > 0)
    est, se = est[ok], se[ok]
    k = len(est)
    if k < 2:
        return dict(k=k, est=float(est[0]) if k else np.nan, lo=np.nan, hi=np.nan, pi_lo=np.nan, pi_hi=np.nan,
                    tau2=np.nan, i2=np.nan, q_p=np.nan)
    w = 1 / se ** 2
    fixed = np.sum(w * est) / w.sum()
    Q = float(np.sum(w * (est - fixed) ** 2))
    C = w.sum() - np.sum(w ** 2) / w.sum()
    tau2 = max(0.0, (Q - (k - 1)) / C)
    ws = 1 / (se ** 2 + tau2)
    mu = float(np.sum(ws * est) / ws.sum())
    q = float(np.sum(ws * (est - mu) ** 2) / (k - 1))
    se_hk = float(np.sqrt(max(q, 1.0) / ws.sum()))
    a = 1 - level
    t1 = stats.t.ppf(1 - a / 2, k - 1)
    t2 = stats.t.ppf(1 - a / 2, max(k - 2, 1))
    pi_half = t2 * np.sqrt(tau2 + 1 / ws.sum())
    return dict(k=k, est=mu, lo=mu - t1 * se_hk, hi=mu + t1 * se_hk, pi_lo=mu - pi_half, pi_hi=mu + pi_half,
                tau2=float(tau2), i2=float(max(0.0, (Q - (k - 1)) / Q)) if Q > 0 else 0.0,
                q_p=float(1 - stats.chi2.cdf(Q, k - 1)))


def pool_table(site_tab: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (m, h), g in site_tab.groupby(["model", "horizon"]):
        specs = [("uno_c", g.uno_c, g.uno_c_se, False), ("auc", g.auc, g.auc_se, False),
                 ("skill", g.skill, g.skill_se, False), ("slope", g.slope, g.slope_se, False),
                 ("oe", np.log(g.oe), g.ln_oe_se, True)]
        for name, est, se, is_log in specs:
            r = meta(est.to_numpy(), se.to_numpy())
            if is_log:
                for key in ("est", "lo", "hi", "pi_lo", "pi_hi"):
                    r[key] = float(np.exp(r[key]))
            rows.append(dict(model=m, horizon=h, metric=name, **r))
    return pd.DataFrame(rows)


def paired_delta_c(site_tab: pd.DataFrame, boots: dict, ref="clinical", others=None):
    """Uno C of `ref` minus each other model, per site (paired-bootstrap SE) and pooled across sites."""
    others = others or [m for m in site_tab.model.unique() if m != ref]
    point = site_tab.groupby(["site", "model"]).uno_c.first()
    rows = []
    for o in others:
        ds, ses = [], []
        for s, b in boots.items():
            diff = b[(ref, "uno_c")] - b[(o, "uno_c")]
            ds.append(float(point[(s, ref)] - point[(s, o)]))
            ses.append(float(np.nanstd(diff, ddof=1)))
            rows.append(dict(comparator=o, site=s, delta=ds[-1], se=ses[-1]))
        r = meta(ds, ses)
        rows.append(dict(comparator=o, site="pooled", delta=r["est"], se=np.nan, lo=r["lo"], hi=r["hi"],
                         pi_lo=r["pi_lo"], pi_hi=r["pi_hi"], tau2=r["tau2"], i2=r["i2"]))
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ local recalibration
def recal_curve(fit: CoxSpec, te: pd.DataFrame, h=36, sizes=(25, 50, 100, 200, 400), reps=200, seed=0, min_eval=50):
    """Update kappa on n_local local patients; score absolute 36-month calibration error on the others."""
    t, e = te["time"].to_numpy(float), te["event"].to_numpy(float)
    n = len(t)
    lp = fit.lp(te)
    H = float(fit.model.H0(h)[0])
    base_risk = 1 - np.exp(-H * np.exp(lp))
    rng = np.random.default_rng(seed)
    rows = []
    for m in sizes:
        if n - m < min_eval:
            continue
        for r in range(reps):
            loc = rng.choice(n, m, replace=False)
            ev = np.setdiff1d(np.arange(n), loc)
            k = cox.kappa(fit.model, None, t[loc], e[loc], horizon=h, lp=lp[loc])
            kf = cox.kappa(fit.model, None, t[loc], e[loc], horizon=None, lp=lp[loc])
            obs = surv.risk_km(t[ev], e[ev], h)
            rec = 1 - np.exp(-k["kappa"] * H * np.exp(lp[ev]))
            rec_full = 1 - np.exp(-kf["kappa"] * H * np.exp(lp[ev]))
            rows.append(dict(n_local=m, rep=r, kappa=k["kappa"], k_lo=k["lo"], k_hi=k["hi"], events=k["observed"],
                             err_before=abs(base_risk[ev].mean() - obs), err_after=abs(rec.mean() - obs),
                             err_full=abs(rec_full.mean() - obs), kappa_full=kf["kappa"],
                             err_policy=abs(rec.mean() - obs) if (k["lo"] > 1 or k["hi"] < 1) else abs(base_risk[ev].mean() - obs),
                             signed_before=base_risk[ev].mean() - obs, signed_after=rec.mean() - obs,
                             excludes_1=bool(k["lo"] > 1 or k["hi"] < 1)))
    return pd.DataFrame(rows)


def summarise_recal(c: pd.DataFrame, within=0.02) -> pd.DataFrame:
    g = c.groupby("n_local")
    out = g.agg(err_before=("err_before", "median"), err_after=("err_after", "median"),
                err_full=("err_full", "median"), err_policy=("err_policy", "median"),
                err_after_q75=("err_after", lambda x: x.quantile(0.75)),
                kappa_med=("kappa", "median"), detect=("excludes_1", "mean"), events=("events", "median"))
    out["within_after"] = g.apply(lambda x: (x.err_after <= within).mean(), include_groups=False)
    out["within_before"] = g.apply(lambda x: (x.err_before <= within).mean(), include_groups=False)
    return out.reset_index()

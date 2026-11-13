#!/usr/bin/env python3
"""Run every analysis in docs/ANALYSIS_PLAN.md and write tables to results/.

    python scripts/run_all.py            # everything
    python scripts/run_all.py h1 h2      # selected stages: data h1 h2 h3 h5 h4 x
"""
import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
warnings.filterwarnings("ignore")

from gdclens import cox, data as D, extras as X, labelbias, models as M, passport as P, safe_rule as S, surv, transport as T  # noqa: E402

OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)
SEED = 20261109


def save(df, name):
    df.to_csv(OUT / f"{name}.csv", index=False)
    return df


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def stage_data():
    d, excl = D.harmonise(return_excluded=True)
    D.PROCESSED.parent.mkdir(parents=True, exist_ok=True)
    d.to_csv(D.PROCESSED, index=False)
    pd.DataFrame(excl, columns=["step", "patients"]).to_csv(OUT / "exclusions.csv", index=False)
    rows = []
    for s, g in d.groupby("site", sort=False):
        t, e = g.time.to_numpy(float), g.event.to_numpy(float)
        rows.append(dict(site=s, source=g.source.iloc[0], n=len(g), deaths=int(e.sum()),
                         followup_median=surv.median_followup(t, e), age_median=g.age.median(),
                         er_pos=(g.ER == "pos").mean(), her2_pos=(g.HER2 == "pos").mean(),
                         t1=(g["T"] == 1).mean(), n0=(g["N"] == 0).mean(), km36=surv.risk_km(t, e, 36),
                         km60=surv.risk_km(t, e, 60) if t.max() > 60 else np.nan))
    order = {s: i for i, s in enumerate(D.SITES)}
    save(pd.DataFrame(rows).sort_values("site", key=lambda c: c.map(order)), "cohorts")
    return d


def stage_h1(d):
    log("H1 label bias")
    groups = {"TCGA": d.index[d.site == "TCGA"], "METABRIC (all)": d.index[d.site != "TCGA"]}
    for s in D.SITES[1:]:
        groups[s] = d.index[d.site == s]
    save(labelbias.audit_table(d, groups, B=1000, seed=SEED), "label_bias")
    save(labelbias.simulation_grid(seed=SEED), "label_sim")


def stage_h2(d):
    log("H2 leave-one-site-out")
    fits, preds = T.loco_run(d)
    log("  fitted")
    tab, boots = T.loco_evaluate(preds, B=200, seed=SEED)
    save(tab, "site_metrics")
    save(T.pool_table(tab), "pooled_metrics")
    save(T.paired_delta_c(tab, boots), "delta_c")
    # ranking under naive labels (H1 follow-up): does model order change?
    rows = []
    for s in ("TCGA",):
        te, pr = preds[s]
        r = labelbias.ranking_check({m: pr[m]["risk"][36] for m in pr}, te, 36)
        r.insert(0, "site", s)
        rows.append(r)
    save(pd.concat(rows), "label_ranking")
    # canary: shuffled outcomes must give concordance near 0.5
    rng = np.random.default_rng(SEED)
    rows = []
    for s in D.SITES:
        tr, te = d[d.site != s].reset_index(drop=True), d[d.site == s].reset_index(drop=True)
        tau = T.tau_for(te.time.to_numpy(float), te.event.to_numpy(float))
        for r in range(20):
            sh = tr.copy()
            perm = rng.permutation(len(sh))
            sh["time"], sh["event"] = tr.time.to_numpy()[perm], tr.event.to_numpy()[perm]
            m = M.CoxSpec("clinical").fit(sh)
            rows.append(dict(site=s, rep=r, uno_c=surv.uno_c(te.time.to_numpy(float), te.event.to_numpy(float), m.lp(te), tau)))
    save(pd.DataFrame(rows), "canary")
    return fits, preds


def stage_h3(d, fits=None):
    log("H3 local recalibration")
    rows = []
    for s in D.SITES:
        te = d[d.site == s].reset_index(drop=True)
        f = fits[(s, "clinical")] if fits else M.CoxSpec("clinical").fit(d[d.site != s])
        c = T.recal_curve(f, te, h=36, reps=200, seed=SEED)
        sm = T.summarise_recal(c)
        sm.insert(0, "site", s)
        rows.append(sm)
    save(pd.concat(rows), "recal_summary")


def stage_h5(d):
    log("H5 safe reassurance")
    rng = np.random.default_rng(SEED)
    rows = []
    for s in D.SITES:
        tr, te = d[d.site != s].reset_index(drop=True), d[d.site == s].reset_index(drop=True)
        oof = S.oof_risk(tr)
        m = M.CoxSpec("clinical").fit(tr)
        p = m.risk(te, 36)
        t, e = te.time.to_numpy(float), te.event.to_numpy(float)
        lp, H = m.lp(te), float(m.model.H0(36)[0])
        for spec, alpha, min_n in (("primary", 0.05, 250), ("original_min_n", 0.05, 100),
                                   ("sens_7.5", 0.075, 250), ("sens_10", 0.10, 250)):
            lam = S.choose_lambda(oof, tr.time, tr.event, alpha=alpha, min_n=min_n)
            r0 = S.evaluate(p, t, e, lam)
            rows.append(dict(site=s, spec=spec, alpha=alpha, min_n=min_n, update="none", **r0))
            if lam is None:
                continue
            res = []
            for _ in range(200):  # kappa from 100 local patients, rule scored on the rest
                loc = rng.choice(len(te), 100, replace=False)
                ev = np.setdiff1d(np.arange(len(te)), loc)
                k = cox.kappa(m.model, None, t[loc], e[loc], horizon=36, lp=lp[loc])["kappa"]
                pk = 1 - np.exp(-k * H * np.exp(lp[ev]))
                res.append(S.evaluate(pk, t[ev], e[ev], lam))
            rr = pd.DataFrame(res)
            rows.append(dict(site=s, spec=spec, alpha=alpha, min_n=min_n, update="kappa100", lam=lam,
                             coverage=rr.coverage.mean(), n=rr.n.mean(), deaths=rr.deaths.mean(), km=rr.km.mean(),
                             lo=rr.lo.mean(), hi=rr.hi.mean(), over_alpha=float((rr.km > alpha).mean())))
    save(pd.DataFrame(rows), "rule_eval")


def stage_h4(d):
    log("H4 passport validation")
    pp, tab, tests = P.validate_loco(d, B=100, n_perm=1000, seed=SEED)
    save(pp.drop(columns=[]), "passport_patients")
    save(tab, "passport_groups")
    (OUT / "passport_tests.json").write_text(json.dumps(tests, indent=1))


def stage_x(d):
    log("exploratory analyses")
    save(X.window_sensitivity(d), "x_window")
    save(X.ph_check(d), "x_ph")
    tab, pooled = X.ladder(d, B=200, seed=SEED)
    save(tab, "x_ladder_sites")
    save(pooled, "x_ladder")
    tab, pooled = X.endpoint_sensitivity(d, B=200, seed=SEED)
    save(tab, "x_endpoint_sites")
    save(pooled, "x_endpoint")


if __name__ == "__main__":
    want = sys.argv[1:] or ["data", "h1", "h2", "h3", "h5", "h4", "x"]
    t0 = time.time()
    d = stage_data() if "data" in want else D.load()
    fits = None
    if "h1" in want:
        stage_h1(d)
    if "h2" in want:
        fits, _ = stage_h2(d)
    if "h3" in want:
        stage_h3(d, fits)
    if "h5" in want:
        stage_h5(d)
    if "h4" in want:
        stage_h4(d)
    if "x" in want:
        stage_x(d)
    log(f"done in {time.time() - t0:.0f}s")

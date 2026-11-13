#!/usr/bin/env python3
"""Write everything the web app needs to web/public/data/ (model, lookup table, results, test vectors, demo file)."""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
warnings.filterwarnings("ignore")

from gdclens import audit, cox, data as D, export as E, labelbias, models as M, passport as P, safe_rule as S, surv, transport as T, verdicts  # noqa: E402

OUT = ROOT / "web" / "public" / "data"
RES = ROOT / "results"
SEED = 20261109
OUT.mkdir(parents=True, exist_ok=True)


def clean(o):
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def dump(obj, name, indent=None):
    (OUT / name).write_text(json.dumps(clean(obj), separators=(",", ":") if indent is None else None, indent=indent))


def table(name, k=5):
    return E.df_records(pd.read_csv(RES / f"{name}.csv"), k)


def make_demo(clin):
    """Synthetic hospital with a known shift (kappa 0.6, younger, more node-negative); no patient data is shipped."""
    rs = np.random.default_rng(SEED)
    k_true, nh = 0.6, 1500
    ages = np.clip(np.round(rs.normal(54, 11, nh)), 25, 90)
    Tn = rs.choice([1, 2, 3], nh, p=[0.45, 0.45, 0.10])
    Nn = rs.choice([0, 1, 2, 3], nh, p=[0.55, 0.28, 0.11, 0.06])
    ER = rs.choice(["pos", "neg"], nh, p=[0.76, 0.24])
    PR = np.where(ER == "pos", rs.choice(["pos", "neg"], nh, p=[0.78, 0.22]), rs.choice(["pos", "neg"], nh, p=[0.1, 0.9]))
    HER2 = rs.choice(["neg", "pos"], nh, p=[0.84, 0.16])
    hosp = pd.DataFrame(dict(age=ages, T=Tn, N=Nn, ER=ER, PR=PR, HER2=HER2))
    lp_h = clin.lp(hosp)
    H = lambda tm: np.interp(tm, clin.model.base_t, clin.model.base_H, left=0.0)
    u = rs.uniform(size=nh)
    grid_tm = np.arange(0.25, 240.01, 0.25)
    Hg = np.array([float(clin.model.H0(x_)[0]) for x_ in grid_tm])
    target = -np.log(u)
    time_ev = np.array([grid_tm[min(np.searchsorted(k_true * Hg * np.exp(l), tg), len(grid_tm) - 1)] for l, tg in zip(lp_h, target)])
    cens = rs.uniform(24, 120, nh)
    hosp["time_months"] = np.round(np.minimum(time_ev, cens), 2)
    hosp["event"] = (time_ev <= cens).astype(int)
    hosp.to_csv(ROOT / "web" / "public" / "demo_hospital.csv", index=False)
    print("demo hospital: events", int(hosp.event.sum()), "of", nh)


def make_hospital_parity(clin):
    """Python reference numbers for the hospital page, computed on the shipped demo file."""
    h = pd.read_csv(ROOT / "web" / "public" / "demo_hospital.csv")
    t, e = h.time_months.to_numpy(float), h.event.to_numpy(float)
    x = h[M.INPUTS]
    lp = clin.lp(x)
    lp_tie = np.round(lp, 9)  # ages on a plateau of the monotone age effect tie exactly in the browser; float noise must not split them here
    tau = T.tau_for(t, e)
    risk = {k: clin.risk(x, k) for k in (36, 60, 120)}
    f = surv.km(t, e)
    rule = json.loads((OUT / "results.json").read_text())["rule_final"]
    lam = rule["0.05"]["lam"]
    m = risk[36] <= lam
    r, se, up = S.km_upper(t[m], e[m], 36)
    known = float(np.mean(((t <= 36) & (e == 1)) | (t > 36)))
    dump(dict(n=len(h), deaths=int(e.sum()), tau=tau, followup_median=surv.median_followup(t, e), uno_c=surv.uno_c(t, e, lp_tie, tau),
              auc36=surv.td_auc(t, e, lp_tie, 36), km36=float(1 - f.at(36)[0]), km36_se=float(np.sqrt(f.var_at(36)[0])),
              cal36=surv.calibration_in_the_large(t, e, risk[36], 36), kappa36=cox.kappa(clin.model, None, t, e, horizon=36, lp=lp),
              kappa_full=cox.kappa(clin.model, None, t, e, lp=lp), mean_risk36=float(risk[36].mean()), known36=known,
              rule=dict(alpha=0.05, lam=lam, n=int(m.sum()), est=r, se=se, upper=up)), "parity_hospital.json")


def main():
    d = D.load()
    clin = M.CoxSpec("clinical").fit(d)
    if "--demo-only" in sys.argv:
        make_demo(clin)
        return make_hospital_parity(clin)
    met = d[d.site != "TCGA"].reset_index(drop=True)
    red = M.CoxSpec("reduced").fit(met)
    dump(E.model_json(clin, d, "clinical", D.SITES), "model.json")
    dump(E.model_json(red, met, "reduced", D.SITES[1:]), "model_reduced.json")

    g, audit_summary = E.grid_json(clin, d, B=300, seed=SEED)
    dump(g, "grid.json")
    oof = S.oof_risk(d)
    rule = E.rule_json(oof, d)

    # reduced model on the TCGA snapshot (external): reference numbers for the live page
    tc = d[d.site == "TCGA"].reset_index(drop=True)
    t, e = tc.time.to_numpy(float), tc.event.to_numpy(float)
    lp, tau = red.lp(tc), T.tau_for(t, e)
    p36 = red.risk(tc, 36)
    k36 = cox.kappa(red.model, None, t, e, horizon=36, lp=lp)
    cal = surv.calibration_in_the_large(t, e, p36, 36)
    snap = dict(n=len(tc), deaths=int(e.sum()), uno_c=surv.uno_c(t, e, lp, tau), tau=tau, auc36=surv.td_auc(t, e, lp, 36),
                oe36=cal["oe"], obs36=cal["obs"], exp36=cal["exp"], kappa36=k36["kappa"], kappa_lo=k36["lo"], kappa_hi=k36["hi"],
                followup_median=surv.median_followup(t, e))

    # verdicts from the result tables
    v = verdicts.compute()
    (RES / "verdicts.json").write_text(json.dumps(clean(v), indent=1))

    canary = pd.read_csv(RES / "canary.csv").groupby("site").uno_c.agg(["mean", "std"]).reset_index()
    pp = pd.read_csv(RES / "passport_patients.csv")
    comp = {c: pp[f"light_{c}"].value_counts().to_dict() for c in P.COMPONENTS}
    grid_verdict = pd.Series(g["verdict"]).map(dict(enumerate(P.VERDICTS))).value_counts().to_dict()

    results = dict(
        version="1.0.0", sites=D.SITES, cohorts=table("cohorts"), exclusions=table("exclusions"),
        label_bias=table("label_bias"), label_sim=table("label_sim"), label_ranking=table("label_ranking"),
        site_metrics=table("site_metrics"), pooled_metrics=table("pooled_metrics"), delta_c=table("delta_c"),
        recal=table("recal_summary"), rule_eval=table("rule_eval"), rule_final=rule,
        passport_groups=table("passport_groups"), passport_tests=json.loads((RES / "passport_tests.json").read_text()),
        passport_components_loco=comp, passport_verdicts_loco=pp.verdict.value_counts().to_dict(), passport_verdicts_grid=grid_verdict,
        canary=E.df_records(canary), audit=dict(summary=audit_summary, rules=audit.RULES, advisory=audit.ADVISORY),
        coefficients=E.df_records(clin.coef_table(), 6), verdicts=v,
        calibration=E.calibration_bins(oof, d), decision=E.decision_curves(oof, d),
        exploratory=dict(window=table("x_window"), ph=table("x_ph"), ladder=table("x_ladder"), ladder_sites=table("x_ladder_sites"),
                         endpoint=table("x_endpoint"), endpoint_sites=table("x_endpoint_sites")),
        live_snapshot=snap, thresholds=dict(support=[30, 10], stability=[0.15, 0.30], precision=[0.10, 0.20],
                                            local_gap=[0.05, 0.10], local_z=[1.0, 2.0]),
    )
    dump(results, "results.json")

    # --- test vectors for the browser statistics library
    rng = np.random.default_rng(11)
    n = 300
    x = rng.normal(size=(n, 2))
    tt = rng.exponential(60 / np.exp(0.6 * x[:, 0] - 0.3 * x[:, 1]))
    cc = rng.exponential(80, n)
    ti, ev = np.round(np.minimum(tt, cc), 3), (tt <= cc).astype(float)
    m = cox.fit(x, ti, ev)
    lp_t = m.lp(x)
    risk = m.risk(x, 36)
    G = surv.reverse_km(ti, ev)
    kp = cox.kappa(m, x, ti, ev, horizon=36)
    kf = cox.kappa(m, x, ti, ev)
    grid_t = np.array([5.0, 20.0, 36.0, 60.0, 100.0])
    fx = dict(
        time=ti, event=ev, risk36=risk, lp=lp_t, base_t=m.base_t, base_H=m.base_H, grid=grid_t,
        km=surv.km(ti, ev).at(grid_t), km_var=surv.km(ti, ev).var_at(grid_t), G_left=G.left(grid_t), G_at=G.at(grid_t),
        weights36=surv.ipcw_weights(ti, ev, 36, G), brier36=surv.brier(ti, ev, risk, 36), uno_c=surv.uno_c(ti, ev, lp_t, 60),
        auc36=surv.td_auc(ti, ev, lp_t, 36), cal36=surv.calibration_in_the_large(ti, ev, risk, 36),
        kappa36=kp, kappa_full=kf, label36=labelbias.estimators(ti, ev, 36), label60=labelbias.estimators(ti, ev, 60),
        median_followup=surv.median_followup(ti, ev),
        chi2=[[p, df, float(__import__("scipy.stats", fromlist=["chi2"]).chi2.ppf(p, df))] for p in (0.025, 0.5, 0.975) for df in (2, 8, 40, 300)],
    )
    dump(fx, "parity.json")
    probe = d.sample(150, random_state=5)[M.INPUTS].reset_index(drop=True)
    dump(dict(profiles=probe.to_dict(orient="records"), lp=clin.lp(probe), risk36=clin.risk(probe, 36), risk60=clin.risk(probe, 60),
              risk120=clin.risk(probe, 120)), "parity_model.json")

    make_demo(clin)
    make_hospital_parity(clin)
    print("exported; grid verdicts:", grid_verdict)


if __name__ == "__main__":
    main()

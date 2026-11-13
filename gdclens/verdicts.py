"""Hypothesis verdicts computed from the result tables, using the criteria fixed in docs/ANALYSIS_PLAN.md."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

RES = Path(__file__).resolve().parent.parent / "results"
pct = lambda x, k=1: f"{100 * x:.{k}f}"


def _read(name):
    return pd.read_csv(RES / f"{name}.csv")


def compute(res_dir: Path = RES) -> dict:
    lb, pm, rc, rule = _read("label_bias"), _read("pooled_metrics"), _read("recal_summary"), _read("rule_eval")
    out = {}

    # H1 ---------------------------------------------------------------
    t = lb[lb.group == "TCGA"].set_index("horizon")
    m = lb[lb.group == "METABRIC (all)"].set_index("horizon")
    ok = all(t.loc[h, "bias_naive_hi"] < 0 and t.loc[h, "bias_drop_lo"] > 0 for h in (36, 60)) and abs(m.loc[36, "bias_naive"]) < 0.01
    out["H1"] = dict(
        status="supported" if ok else "not supported",
        title="Binary labels misstate mortality when follow-up is short",
        headline=(f"In TCGA (median follow-up {t.loc[36, 'followup_median']:.0f} months, {pct(t.loc[36, 'unknown_status'], 0)}% of patients with unknown "
                  f"36-month status) censored-as-alive gives {pct(t.loc[36, 'naive'])}% against a Kaplan-Meier {pct(t.loc[36, 'km'])}% at 36 months "
                  f"(bias {pct(t.loc[36, 'bias_naive'])} points, 95% CI {pct(t.loc[36, 'bias_naive_lo'])} to {pct(t.loc[36, 'bias_naive_hi'])}); "
                  f"dropping censored patients gives {pct(t.loc[36, 'drop'])}%. At 60 months: {pct(t.loc[60, 'naive'])}% and {pct(t.loc[60, 'drop'])}% "
                  f"against {pct(t.loc[60, 'km'])}%. In METABRIC the 36-month bias is {pct(m.loc[36, 'bias_naive'], 2)} points."),
        numbers=dict(tcga_km36=t.loc[36, "km"], tcga_naive36=t.loc[36, "naive"], tcga_drop36=t.loc[36, "drop"],
                     tcga_naive60=t.loc[60, "naive"], tcga_km60=t.loc[60, "km"], tcga_drop60=t.loc[60, "drop"],
                     met_bias36=m.loc[36, "bias_naive"]))

    # H2 ---------------------------------------------------------------
    c = pm[(pm.model == "clinical") & (pm.horizon == 36)].set_index("metric")
    oe, sl, uc = c.loc["oe"], c.loc["slope"], c.loc["uno_c"]
    ok = (oe.i2 > 0.5 or not (oe.pi_lo <= 1 <= oe.pi_hi)) and (sl.pi_lo <= 1 <= sl.pi_hi)
    out["H2"] = dict(
        status="supported" if ok else "not supported",
        title="Discrimination transports; calibration-in-the-large does not",
        headline=(f"Held-out Uno C {uc.est:.3f} (95% CI {uc.lo:.3f}-{uc.hi:.3f}; prediction interval {uc.pi_lo:.3f}-{uc.pi_hi:.3f}). "
                  f"Calibration slope {sl.est:.2f} (prediction interval {sl.pi_lo:.2f}-{sl.pi_hi:.2f}). "
                  f"Observed/expected 36-month mortality pools to {oe.est:.2f} but varies from site to site: "
                  f"I-squared {pct(oe.i2, 0)}%, prediction interval {oe.pi_lo:.2f}-{oe.pi_hi:.2f}."),
        numbers=dict(c=uc.est, c_lo=uc.lo, c_hi=uc.hi, slope=sl.est, slope_pi_lo=sl.pi_lo, slope_pi_hi=sl.pi_hi,
                     oe=oe.est, oe_i2=oe.i2, oe_pi_lo=oe.pi_lo, oe_pi_hi=oe.pi_hi))

    # H3 ---------------------------------------------------------------
    r100 = rc[rc.n_local == 100].set_index("site")
    better = [s for s in r100.index if r100.loc[s, "err_after"] < r100.loc[s, "err_before"]]
    worse = [s for s in r100.index if s not in better]
    status = "supported" if len(better) == len(r100) else ("partly supported" if better else "not supported")
    out["H3"] = dict(
        status=status,
        title="Re-estimating one scalar locally reduces calibration error",
        headline=(f"With 100 local patients the 36-month error fell in {', '.join(better) or 'no site'} "
                  f"({'; '.join(f'{s} {pct(r100.loc[s, 'err_before'])} to {pct(r100.loc[s, 'err_after'])} points' for s in better)}) and rose in "
                  f"{', '.join(worse) or 'no site'}, where the transported model was already close "
                  f"({'; '.join(f'{s} {pct(r100.loc[s, 'err_before'])} to {pct(r100.loc[s, 'err_after'])}' for s in worse)}). "
                  "The estimate is noisy because only a handful of deaths occur by 36 months in 100 patients."),
        numbers=dict(improved=better, worsened=worse))

    # H4 ---------------------------------------------------------------
    tests = json.loads((res_dir / "passport_tests.json").read_text())
    ps = [tests["ABSTAIN"]["p"], tests["SHOW WITH CAUTION"]["p"]]
    out["H4"] = dict(
        status="supported" if all(p < 0.05 for p in ps) else "not supported",
        title="Passport verdicts identify where calibration fails",
        headline=(f"Absolute calibration gap in ABSTAIN minus SHOW groups: {pct(tests['ABSTAIN']['stat'])} points "
                  f"(permutation p = {tests['ABSTAIN']['p']:.2f}); CAUTION minus SHOW: {pct(tests['SHOW WITH CAUTION']['stat'])} points "
                  f"(p = {tests['SHOW WITH CAUTION']['p']:.2f}). The verdicts describe how much evidence exists, not where the model is wrong."),
        numbers=tests)

    # H5 ---------------------------------------------------------------
    p0 = rule[(rule.spec == "primary") & (rule["update"] == "none")].set_index("site")
    ok_sites = [s for s in p0.index if p0.loc[s, "n"] > 0 and p0.loc[s, "km"] <= 0.05 + 1e-12]
    o0 = rule[(rule.spec == "original_min_n") & (rule["update"] == "none")]
    none_found = int((o0.coverage == 0).sum()) + (6 - len(o0))
    out["H5"] = dict(
        status="supported" if len(ok_sites) >= 5 else "not supported",
        title="A risk threshold chosen on other sites keeps false reassurance within 5%",
        headline=(f"Observed 36-month mortality among reassured patients was at or below 5% in {len(ok_sites)} of 6 held-out sites "
                  f"(range {pct(p0.km.min())}-{pct(p0.km.max())}%), with coverage {pct(p0.coverage.min(), 0)}-{pct(p0.coverage.max(), 0)}%. "
                  f"With the minimum set size fixed in the plan (100 patients) no threshold could be certified in {none_found} of 6 folds."),
        numbers=dict(sites_ok=ok_sites, km_min=float(p0.km.min()), km_max=float(p0.km.max())))
    return out


if __name__ == "__main__":
    v = compute()
    (RES / "verdicts.json").write_text(json.dumps(v, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    for k, x in v.items():
        print(k, x["status"], "-", x["headline"], "\n")

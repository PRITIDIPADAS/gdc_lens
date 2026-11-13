#!/usr/bin/env python3
"""Write docs/RESULTS.md from web/public/data/results.json, so every number in the write-up comes from the analysis output.

    python scripts/make_results_md.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "web" / "public" / "data" / "results.json").read_text())
SITE_NAME = {"TCGA": "TCGA-BRCA", "M1": "METABRIC 1", "M2": "METABRIC 2", "M3": "METABRIC 3", "M4": "METABRIC 4", "M5": "METABRIC 5"}
MODEL_NAME = {"stage": "Stage group (Cox)", "age_stage": "Age and stage group (Cox)", "clinical": "Deployed model (Cox)",
              "rsf": "Random survival forest", "gbsa": "Gradient-boosted survival"}


def pct(x, d=1):
    return "–" if x is None else f"{100 * x:.{d}f}%"


def num(x, d=3):
    return "–" if x is None else f"{x:.{d}f}"


def md_table(head, rows, align=None):
    align = align or ["l"] + ["r"] * (len(head) - 1)
    sep = ["---:" if a == "r" else ":---" for a in align]
    out = ["| " + " | ".join(head) + " |", "| " + " | ".join(sep) + " |"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def cohorts():
    rows = [[SITE_NAME[c["site"]], c["source"], f"{c['n']:,}", f"{c['deaths']:,}", f"{c['followup_median']:.0f}", f"{c['age_median']:.0f}",
             pct(c["er_pos"], 0), pct(c["her2_pos"], 0), pct(c["n0"], 0), pct(c["km36"]), pct(c["km60"])] for c in R["cohorts"]]
    return md_table(["Site", "Source", "Patients", "Deaths", "Median follow-up (months)", "Median age", "ER+", "HER2+", "pN0", "Mortality 3 y", "Mortality 5 y"], rows,
                    ["l", "l"] + ["r"] * 9)


def exclusions():
    ex = R["exclusions"]
    rows = [[ex[0]["step"].replace("patients in source files", "In the source files"), f"{ex[0]['patients']:,}"]]
    rows += [[f"Left out: {e['step']}", f"{e['patients']:,}"] for e in ex[1:]]
    rows.append(["Analysed", f"{sum(c['n'] for c in R['cohorts']):,}"])
    return md_table(["Step", "Patients"], rows)


def held_out():
    rows = []
    for s in R["sites"]:
        m = next(x for x in R["site_metrics"] if x["site"] == s and x["model"] == "clinical" and x["horizon"] == 36)
        rows.append([SITE_NAME[s], f"{m['n']:,}", f"{m['deaths']:,}", num(m["uno_c"]), num(m["auc"]), num(m["skill"]), num(m["oe"], 2), num(m["slope"], 2), num(m["ici"], 3)])
    pm = {p["metric"]: p for p in R["pooled_metrics"] if p["model"] == "clinical" and p["horizon"] == 36}
    pool = lambda k, d: f"{num(pm[k]['est'], d)} ({num(pm[k]['lo'], d)} to {num(pm[k]['hi'], d)})"
    pred = lambda k, d: f"{num(pm[k]['pi_lo'], d)} to {num(pm[k]['pi_hi'], d)}"
    rows.append(["**Pooled (95% interval)**", "", "", pool("uno_c", 3), pool("auc", 3), pool("skill", 3), pool("oe", 2), pool("slope", 2), ""])
    rows.append(["**95% prediction interval**", "", "", pred("uno_c", 3), pred("auc", 3), pred("skill", 3), pred("oe", 2), pred("slope", 2), ""])
    rows.append(["**I-squared**", "", "", f"{100 * pm['uno_c']['i2']:.0f}%", f"{100 * pm['auc']['i2']:.0f}%", f"{100 * pm['skill']['i2']:.0f}%", f"{100 * pm['oe']['i2']:.0f}%", f"{100 * pm['slope']['i2']:.0f}%", ""])
    return md_table(["Held-out site", "Patients", "Deaths", "Uno C", "AUC 3 y", "Brier skill 3 y", "Observed / expected 3 y", "Calibration slope", "ICI 3 y"], rows)


def benchmarks():
    rows = []
    for m in ["stage", "age_stage", "clinical", "rsf", "gbsa"]:
        pm = {p["metric"]: p for p in R["pooled_metrics"] if p["model"] == m and p["horizon"] == 36}
        rows.append([MODEL_NAME[m], f"{num(pm['uno_c']['est'])} ({num(pm['uno_c']['lo'])} to {num(pm['uno_c']['hi'])})", f"{num(pm['uno_c']['pi_lo'])} to {num(pm['uno_c']['pi_hi'])}",
                     f"{num(pm['auc']['est'])}", f"{num(pm['skill']['est'])}", f"{num(pm['oe']['est'], 2)}"])
    return md_table(["Model", "Held-out Uno C (95% interval)", "Prediction interval", "AUC 3 y", "Brier skill 3 y", "Observed / expected 3 y"], rows)


def delta_c():
    names = {"stage": "stage group", "age_stage": "age and stage group", "rsf": "random survival forest", "gbsa": "gradient-boosted survival"}
    rows = []
    for d in R["delta_c"]:
        if d["site"] == "pooled":
            rows.append([f"Deployed model minus {names[d['comparator']]}", f"{d['delta']:+.3f}", f"{d['lo']:+.3f} to {d['hi']:+.3f}", f"{d['pi_lo']:+.3f} to {d['pi_hi']:+.3f}", f"{100 * d['i2']:.0f}%"])
    return md_table(["Paired difference in Uno C", "Pooled", "95% interval", "Prediction interval", "I-squared"], rows)


def hypotheses():
    out = []
    for k, v in R["verdicts"].items():
        out.append(f"**{k}. {v['title']}: {v['status']}.** {v['headline']}")
    return "\n\n".join(out)


def label_bias():
    rows = []
    for g in ("TCGA", "M1", "M3"):
        for h in (36, 60):
            b = next((x for x in R["label_bias"] if x["group"] == g and x["horizon"] == h), None)
            if b:
                rows.append([SITE_NAME[g], f"{h // 12} y", f"{b['followup_median']:.0f}", pct(b["unknown_status"], 0), pct(b["km"]), pct(b["naive"]), f"{100 * b['bias_naive']:+.1f} ({100 * b['bias_naive_lo']:+.1f} to {100 * b['bias_naive_hi']:+.1f})",
                             pct(b["drop"]), f"{100 * b['bias_drop']:+.1f} ({100 * b['bias_drop_lo']:+.1f} to {100 * b['bias_drop_hi']:+.1f})"])
    return md_table(["Cohort", "Horizon", "Median follow-up (months)", "Status unknown", "Kaplan-Meier", "Censored as alive", "Bias, points (95% CI)", "Censored dropped", "Bias, points (95% CI)"], rows)


def rule():
    rows = [[pct(float(a), 1), num(r["lam"], 3), pct(r["coverage"], 0), f"{r['n']:,}", f"{r['deaths']:,}", f"{pct(r['km'])} ({pct(r['lo'])} to {pct(r['hi'])})"] for a, r in R["rule_final"].items()]
    return md_table(["Accepted miss rate", "Risk threshold (3 y)", "Patients reassured", "n reassured", "Deaths among them", "Observed 3-year mortality (95% interval)"], rows)


def passport():
    v = R["passport_verdicts_loco"]
    g = R["passport_verdicts_grid"]
    n, ng = sum(v.values()), sum(g.values())
    rows = [[k.capitalize() if k != "SHOW WITH CAUTION" else "Show with caution", f"{v[k]:,}", pct(v[k] / n, 0), f"{g[k]:,}", pct(g[k] / ng, 1)] for k in ("SHOW", "SHOW WITH CAUTION", "ABSTAIN")]
    t = R["passport_tests"]
    return md_table(["Verdict", "Training patients (held-out evaluation)", "Share", "Profiles in the audit grid", "Share"], rows) + "\n\n" + \
        f"Permutation tests of whether the verdict locates calibration failures at held-out sites: abstain minus show, {100 * t['ABSTAIN']['stat']:.1f} points (p = {t['ABSTAIN']['p']:.2f}); caution minus show, {100 * t['SHOW WITH CAUTION']['stat']:.1f} points (p = {t['SHOW WITH CAUTION']['p']:.2f})."


def audit():
    s = R["audit"]["summary"]
    return f"{s['profiles']:,} profiles checked; {s['all_rules_pass']:,} pass every rule. Failures: hazard-ratio bound {s['hr']['n_fail']}, all other enforced rules 0. The advisory rule on unknown receptors fails for {s['unknown_advisory']['n_fail']:,} profiles by design (see Methods)."


def live():
    s = R["live_snapshot"]
    return (f"Snapshot taken when the site was built (GDC data release 46): {s['n']} patients, {s['deaths']} deaths, median follow-up {s['followup_median']:.1f} months. "
            f"The reduced model (age, pT and pN, fitted to METABRIC only) has Uno C {s['uno_c']:.3f} and AUC at 3 years {s['auc36']:.3f} on TCGA. "
            f"Observed 3-year mortality is {pct(s['obs36'])} against {pct(s['exp36'])} predicted (observed over expected {s['oe36']:.2f}); the local factor is {s['kappa36']:.2f} ({s['kappa_lo']:.2f} to {s['kappa_hi']:.2f}).")


def main():
    text = f"""# Results

Built by the script `scripts/make_results_md.py` from `web/public/data/results.json`, which `scripts/export_web.py` writes from the tables in `results/`.
Do not edit by hand. Pre-specified analysis: [ANALYSIS_PLAN.md](ANALYSIS_PLAN.md). Changes made afterwards: [DEVIATIONS.md](DEVIATIONS.md).
Research use only.

## Data

{cohorts()}

{exclusions()}

The GDC gender field is empty for every TCGA-BRCA case in release 46, so sex is not used.

## Hypotheses

{hypotheses()}

## Held-out performance of the deployed model

Each row is a site the model never saw: the model is fitted on the other five. Three-year horizon.

{held_out()}

## Benchmarks

Same inputs, same held-out sites. For ranking, the flexible models do not beat the small Cox model: the paired differences in Uno C below favour the Cox model or cannot be told from zero. The random survival forest has the higher Brier skill, so the Cox model is not claimed to be the most accurate in every respect. It is the one that can be checked on every input.

{benchmarks()}

{delta_c()}

## Label audit

Censored patients treated as survivors, or dropped, against the Kaplan-Meier estimate.

{label_bias()}

## Safe-to-reassure rule

A risk threshold chosen on out-of-fold predictions so that the upper 95% limit of observed 3-year mortality among reassured patients stays within the accepted miss rate. Minimum set size 250 (Deviation 2).

{rule()}

## Evidence passport

{passport()}

## Audit of the deployed model

{audit()}

## Live check against the GDC

{live()}
"""
    (ROOT / "docs" / "RESULTS.md").write_text(text)
    print("wrote docs/RESULTS.md", len(text.splitlines()), "lines")


if __name__ == "__main__":
    main()

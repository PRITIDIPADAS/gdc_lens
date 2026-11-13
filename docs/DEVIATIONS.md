# Deviations from the analysis plan

Each entry gives what changed, why, and whether it was decided after seeing results. Every pre-specified analysis is
reported in `results/` whatever its direction; deviations never remove a result, they add or re-parameterise one.

| # | Date | Change | Decided after seeing results? |
|---|---|---|---|
| 1 | 2026-11-09 | Age effect made monotone from age 45 | Yes |
| 2 | 2026-11-09 | Minimum set size for the reassurance rule 100 to 250 | Yes |
| 3 | 2026-11-09 | Passport bootstrap size: 100 refits in validation, 300 for the shipped table | No (compute budget) |
| 4 | 2026-11-09 | Exploratory analyses added or dropped | Partly |
| 5 | 2026-11-09 | Sensitivity grid for the rule threshold (alpha 7.5% and 10%) | Yes |

## 1. Age effect made monotone from age 45

The plan lists "risk does not fall with age from 45" as an audit rule for the shipped model. The first
leave-one-site-out run had already been seen when the exhaustive audit showed the fitted age spline dipping at ages
46 to 47, which breaks that rule. The deployed age effect is therefore tabulated at whole years and a running
maximum is taken from age 45; ages in between are interpolated linearly.

Effect on every reported number: across the six held-out sites Uno C changes by at most 0.0006 and the 36-month
observed/expected ratio by at most 0.001. All tables in `results/` use the constrained model.

## 2. Minimum set size for the reassurance rule (H5)

The plan set a minimum of 100 patients below the threshold. After the out-of-fold risk deciles were inspected it
was clear that a set of 100 patients usually holds three or more deaths by 36 months, which already puts the
upper 95% limit above 5%, so no threshold could be certified. With the minimum fixed in the plan, no threshold
exists in 4 of 6 folds; that result is kept in `results/rule_eval.csv` (`spec = original_min_n`) and shown in the
app. The headline analysis uses a minimum of 250 patients. H5 is therefore reported as supported with this
deviation, not as supported as pre-specified.

## 3. Passport bootstrap size

The plan states 200 refits for the precision component. The leave-one-site-out validation uses 100 refits per
fold (six folds, each needs a full passport for every held-out patient); the shipped lookup table uses 300 refits
(computed once). The precision thresholds are on interval width, which depends on the number of refits only through
Monte-Carlo noise.

## 4. Exploratory analyses

Added (labelled exploratory in the app): estimation-window sensitivity (all follow-up versus 60 months), a
proportional-hazards landmark check at 60 months, two additional H3 policies (re-estimating the full set of
baseline and slope versus one scalar, and a test-then-update policy), and the METABRIC-only predictor ladder
(listed in the plan). The endpoint sensitivity listed in the plan (breast-cancer-specific death in METABRIC) was run
after the main results; it shows that other-cause deaths do not explain the discrimination estimates. The
post-baseline treatment-leakage demonstration listed in the plan was not run in this release, and no conclusion
depends on it.

## 5. Sensitivity grid for the rule threshold

With the 5% target certifying only 21 to 62% of patients, two looser targets (7.5% and 10%) were added as a
sensitivity analysis. They are not used for the headline result.

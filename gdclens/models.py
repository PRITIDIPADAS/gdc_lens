"""Candidate prognostic models and their design matrices.

stage      Cox on anatomic stage group
age_stage  Cox on restricted-cubic-spline age + stage group
clinical   Cox on age spline, pT and pN (monotone increments), ER, PR, HER2 (the deployed model)
rsf, gbsa  survival forests / boosting on the same inputs (benchmarks)
"""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

from . import cox
from .basis import quantile_knots, rcs
from .data import derive_stage

AGE_PROBS = (0.05, 0.35, 0.65, 0.95)
STAGE_LEVELS = ["IA", "IIA", "IIB", "IIIA", "IIIB+"]
RECEPTORS = ("ER", "PR", "HER2")
INPUTS = ["age", "T", "N", "ER", "PR", "HER2"]
AGE_RANGE = (20, 95)


def stage5(d: pd.DataFrame) -> pd.Series:
    s = d["stage"] if "stage" in d else pd.Series([derive_stage(t, n) for t, n in zip(d["T"], d["N"])], index=d.index)
    return s.replace({"IIIB": "IIIB+", "IIIC": "IIIB+"})


def _stage_cols(d):
    s = stage5(d)
    return np.column_stack([(s == lv).to_numpy(float) for lv in STAGE_LEVELS[1:]]), [f"stage_{lv}" for lv in STAGE_LEVELS[1:]]


def _receptor_cols(d):
    cols, names = [], []
    for r, other in (("ER", "neg"), ("PR", "neg"), ("HER2", "pos")):
        cols += [(d[r] == other).to_numpy(float), (d[r] == "unk").to_numpy(float)]
        names += [f"{r}_{other}", f"{r}_unk"]
    return np.column_stack(cols), names


AGE_GRID = np.arange(AGE_RANGE[0], AGE_RANGE[1] + 1, dtype=float)
AGE_MONOTONE_FROM = 45


class CoxSpec:
    """A Cox model with its own design matrix; all data-dependent choices (knots) come from the training data.

    Age enters as a restricted cubic spline, tabulated at whole years; from age 45 the tabulated effect is made
    non-decreasing (running maximum), and ages in between are linearly interpolated.
    """

    def __init__(self, kind: str):
        assert kind in ("stage", "age_stage", "clinical", "reduced")
        self.kind = kind

    def design(self, d: pd.DataFrame):
        parts, names, nonneg = [], [], []
        if self.kind != "stage":
            parts.append(rcs(d["age"].to_numpy(float), self.knots))
            names += ["age", "age_nl1", "age_nl2"]
        if self.kind in ("clinical", "reduced"):
            T, N = d["T"].to_numpy(), d["N"].to_numpy()
            base = sum(len(n) for n in names)
            parts.append(np.column_stack([(T >= 2), (T >= 3), (N >= 1), (N >= 2), (N >= 3)]).astype(float))
            names += ["T>=2", "T>=3", "N>=1", "N>=2", "N>=3"]
            nonneg = list(range(base, base + 5))
        if self.kind == "clinical":
            rc, rn = _receptor_cols(d)
            parts.append(rc)
            names += rn
        if self.kind in ("stage", "age_stage"):
            sc, sn = _stage_cols(d)
            parts.append(sc)
            names += sn
        return np.hstack(parts), names, nonneg

    def fit(self, d: pd.DataFrame):
        self.knots = quantile_knots(d["age"], AGE_PROBS)
        X, self.names, nn = self.design(d)
        self.model = cox.fit(X, d["time"].to_numpy(float), d["event"].to_numpy(float), nonneg=nn)
        if self.kind != "stage":
            b = self.model.beta[:3]
            f = rcs(AGE_GRID, self.knots) @ b
            f2 = f.copy()
            k = AGE_MONOTONE_FROM - AGE_RANGE[0]
            f2[k:] = np.maximum.accumulate(f[k:])
            self.age_raw, self.age_table = f, f2
            self.age_mean = float(np.mean(rcs(d["age"].to_numpy(float), self.knots) @ b))
        return self

    def lp(self, d):
        X = self.design(d)[0]
        lp = self.model.lp(X)
        if self.kind == "stage":
            return lp
        a = np.clip(d["age"].to_numpy(float), AGE_RANGE[0], AGE_RANGE[1])
        f_exact = rcs(a, self.knots) @ self.model.beta[:3]
        return lp + (np.interp(a, AGE_GRID, self.age_table) - f_exact)

    def risk(self, d, h, kappa=1.0):
        return 1.0 - np.exp(-kappa * float(self.model.H0(h)[0]) * np.exp(self.lp(d)))

    def coef_table(self) -> pd.DataFrame:
        m = self.model
        return pd.DataFrame({"term": self.names, "beta": m.beta, "se": m.se, "hr": np.exp(m.beta)})


class MLSpec:
    def __init__(self, kind: str, seed: int = 0):
        assert kind in ("rsf", "gbsa")
        self.kind, self.seed = kind, seed

    @staticmethod
    def design(d):
        rc, _ = _receptor_cols(d)
        return np.column_stack([d["age"].to_numpy(float), d["T"].to_numpy(float), d["N"].to_numpy(float), rc])

    def fit(self, d):
        from sksurv.ensemble import GradientBoostingSurvivalAnalysis, RandomSurvivalForest
        from sksurv.util import Surv
        y = Surv.from_arrays(d["event"].to_numpy(bool), d["time"].to_numpy(float))
        if self.kind == "rsf":
            self.m = RandomSurvivalForest(n_estimators=300, min_samples_leaf=20, max_features="sqrt", n_jobs=2,
                                          random_state=self.seed)
        else:
            self.m = GradientBoostingSurvivalAnalysis(loss="coxph", n_estimators=200, learning_rate=0.05, max_depth=2,
                                                      subsample=0.7, random_state=self.seed)
        self.m.fit(self.design(d), y)
        return self

    def lp(self, d):
        return self.m.predict(self.design(d))

    def risk(self, d, h, kappa=1.0):
        S = self.m.predict_survival_function(self.design(d), return_array=True)
        i = np.searchsorted(self.m.unique_times_, h, side="right") - 1
        return np.zeros(len(d)) if i < 0 else 1.0 - S[:, i]


MODEL_IDS = ["stage", "age_stage", "clinical", "rsf", "gbsa"]
LABELS = {"stage": "Stage group", "age_stage": "Age + stage", "clinical": "Clinical Cox (deployed)",
          "rsf": "Random survival forest", "gbsa": "Boosted Cox"}


def make_model(mid: str):
    return CoxSpec(mid) if mid in ("stage", "age_stage", "clinical") else MLSpec(mid)


def profile_grid() -> pd.DataFrame:
    ages = np.arange(AGE_RANGE[0], AGE_RANGE[1] + 1)
    rows = itertools.product(ages, (1, 2, 3), (0, 1, 2, 3), ("pos", "neg", "unk"), ("pos", "neg", "unk"),
                             ("pos", "neg", "unk"))
    g = pd.DataFrame(rows, columns=INPUTS)
    g["age"] = g["age"].astype(float)
    return g


_LEVEL = {"pos": 0, "neg": 1, "unk": 2}


def grid_index(d: pd.DataFrame) -> np.ndarray:
    """Row of each profile in `profile_grid()` (age rounded to whole years and clipped to the grid)."""
    a = np.clip(np.rint(d["age"].to_numpy(float)), AGE_RANGE[0], AGE_RANGE[1]).astype(int) - AGE_RANGE[0]
    er, pr, her2 = (d[c].map(_LEVEL).to_numpy(int) for c in RECEPTORS)
    return ((((a * 3 + (d["T"].to_numpy(int) - 1)) * 4 + d["N"].to_numpy(int)) * 3 + er) * 3 + pr) * 3 + her2

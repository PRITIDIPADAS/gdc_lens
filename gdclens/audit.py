"""Exhaustive audit of a fitted model over the whole input grid against clinical rules."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .models import AGE_RANGE, CoxSpec, profile_grid

AUDIT_HORIZONS = (36, 60, 120)
SHAPE = (AGE_RANGE[1] - AGE_RANGE[0] + 1, 3, 4, 3, 3, 3)  # age, T, N, ER, PR, HER2
HR_BOUND = 50.0
REF = dict(age=60.0, T=1, N=0, ER="pos", PR="pos", HER2="neg")
RULES = {
    "probability": "predicted risks are finite and within [0, 1]",
    "horizon": "risk does not fall as the horizon lengthens (36 <= 60 <= 120 months)",
    "T": "risk does not fall as pT rises, other inputs fixed",
    "N": "risk does not fall as pN rises, other inputs fixed",
    "age": "from age 45 risk does not fall with age, other inputs fixed",
    "hr": f"hazard ratio against the reference profile stays within 1/{HR_BOUND:.0f} to {HR_BOUND:.0f}",
}
ADVISORY = {"unknown": "an unknown receptor status gives a risk between its positive and negative values"}


def _mark_pairs(viol: np.ndarray, axis: int, shape) -> np.ndarray:
    """viol has size-1 along `axis`; flag both profiles that make up a violating pair."""
    out = np.zeros(shape, bool)
    lo = [slice(None)] * len(shape)
    hi = [slice(None)] * len(shape)
    lo[axis], hi[axis] = slice(0, -1), slice(1, None)
    out[tuple(lo)] |= viol
    out[tuple(hi)] |= viol
    return out


def audit(model: CoxSpec, grid: pd.DataFrame | None = None, tol=1e-12):
    grid = profile_grid() if grid is None else grid
    lp = model.lp(grid)
    ref = pd.DataFrame([REF])
    lp_ref = float(model.lp(ref)[0])
    H = {h: float(model.model.H0(h)[0]) for h in AUDIT_HORIZONS}
    risk = {h: 1 - np.exp(-H[h] * np.exp(lp)) for h in AUDIT_HORIZONS}
    LP = lp.reshape(SHAPE)
    fail = {}
    ok = np.ones(len(lp), bool)
    for h in AUDIT_HORIZONS:
        ok &= np.isfinite(risk[h]) & (risk[h] >= 0) & (risk[h] <= 1)
    fail["probability"] = ~ok
    fail["horizon"] = ~((risk[36] <= risk[60] + tol) & (risk[60] <= risk[120] + tol))
    fail["T"] = _mark_pairs(np.diff(LP, axis=1) < -tol, 1, SHAPE).reshape(-1)
    fail["N"] = _mark_pairs(np.diff(LP, axis=2) < -tol, 2, SHAPE).reshape(-1)
    a = np.zeros(SHAPE, bool)
    start = 45 - AGE_RANGE[0]  # index of age 45
    a[start + 1:] = (np.diff(LP, axis=0) < -tol)[start:]
    fail["age"] = a.reshape(-1)
    fail["hr"] = np.abs(lp - lp_ref) > np.log(HR_BOUND)
    adv = np.zeros(SHAPE, bool)
    for ax in (3, 4, 5):
        L = np.moveaxis(LP, ax, -1)  # levels in order pos, neg, unk
        lo, hi = np.minimum(L[..., 0], L[..., 1]), np.maximum(L[..., 0], L[..., 1])
        bad = (L[..., 2] < lo - tol) | (L[..., 2] > hi + tol)
        full = np.zeros(L.shape, bool)
        full[..., 2] = bad
        adv |= np.moveaxis(full, -1, ax)
    flags = pd.DataFrame({k: v for k, v in fail.items()})
    flags["unknown_advisory"] = adv.reshape(-1)
    flags["rules_pass"] = ~flags[list(RULES)].any(axis=1)
    summary = {k: dict(n_fail=int(flags[k].sum()), share=float(flags[k].mean())) for k in list(RULES) + ["unknown_advisory"]}
    summary["profiles"] = len(flags)
    summary["all_rules_pass"] = int(flags["rules_pass"].sum())
    return flags, summary, {h: risk[h] for h in AUDIT_HORIZONS}, lp

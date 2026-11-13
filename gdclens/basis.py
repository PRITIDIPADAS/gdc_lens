"""Restricted cubic spline basis (Harrell) with knots at sample quantiles."""
from __future__ import annotations

import numpy as np


def quantile_knots(x, probs=(0.05, 0.35, 0.65, 0.95)):
    return np.quantile(np.asarray(x, float), probs)


def rcs(x, knots):
    """Columns: x, then k-2 non-linear terms (linear beyond the outer knots). Scaled by (t_k - t_1)^2."""
    x = np.asarray(x, float)
    t = np.asarray(knots, float)
    k = len(t)
    if k < 3:
        return x[:, None]
    pos3 = lambda v: np.maximum(v, 0.0) ** 3
    norm = (t[-1] - t[0]) ** 2
    cols = [x]
    for j in range(k - 2):
        term = (pos3(x - t[j]) - pos3(x - t[k - 2]) * (t[k - 1] - t[j]) / (t[k - 1] - t[k - 2])
                + pos3(x - t[k - 1]) * (t[k - 2] - t[j]) / (t[k - 1] - t[k - 2]))
        cols.append(term / norm)
    return np.column_stack(cols)

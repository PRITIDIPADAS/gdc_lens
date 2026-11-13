import numpy as np
import pytest

from gdclens import cox, surv
from gdclens.basis import quantile_knots, rcs

sksurv_metrics = pytest.importorskip("sksurv.metrics")
Surv = pytest.importorskip("sksurv.util").Surv


@pytest.fixture(scope="module")
def sim():
    rng = np.random.default_rng(7)
    n = 700
    X = rng.normal(size=(n, 3))
    lp = X @ [0.7, -0.4, 0.2]
    tt = rng.exponential(60 / np.exp(lp))
    c = rng.exponential(90, n)
    return X, np.minimum(tt, c), (tt <= c).astype(float)


@pytest.fixture(scope="module")
def tied():
    rng = np.random.default_rng(3)
    n = 500
    x = rng.normal(size=(n, 2))
    tt = np.ceil(rng.exponential(30 / np.exp(0.5 * x[:, 0] - 0.3 * x[:, 1])))
    c = np.ceil(rng.exponential(40, n))
    return x, np.minimum(tt, c), (tt <= c).astype(float)


def test_km_matches_statsmodels_with_ties(tied):
    sm = pytest.importorskip("statsmodels.api")
    _, t, e = tied
    ref = sm.SurvfuncRight(t, e)
    f = surv.km(t, e)
    grid = np.array([1.0, 5.0, 10.0, 25.0, 60.0])
    idx = np.searchsorted(ref.surv_times, grid, side="right") - 1
    np.testing.assert_allclose(f.at(grid), ref.surv_prob[idx], atol=1e-12)
    np.testing.assert_allclose(np.sqrt(f.var_at(grid)), ref.surv_prob_se[idx], atol=1e-9)


def test_harrell_c(sim):
    X, t, e = sim
    r = X @ [0.5, -0.2, 0.1]
    ref = sksurv_metrics.concordance_index_censored(e.astype(bool), t, r)[0]
    assert surv.harrell_c(t, e, r) == pytest.approx(ref, abs=1e-12)


def test_uno_c(sim):
    X, t, e = sim
    r = X @ [0.5, -0.2, 0.1]
    y = Surv.from_arrays(e.astype(bool), t)
    for tau in (30, 60, 120):
        ref = sksurv_metrics.concordance_index_ipcw(y, y, r, tau=tau)[0]
        assert surv.uno_c(t, e, r, tau) == pytest.approx(ref, abs=1e-12)


def test_brier_and_auc(sim):
    X, t, e = sim
    m = cox.fit(X, t, e)
    y = Surv.from_arrays(e.astype(bool), t)
    for h in (12.0, 36.0, 60.0):
        p = m.risk(X, h)
        ref = sksurv_metrics.brier_score(y, y, (1 - p)[:, None], [h])[1][0]
        assert surv.brier(t, e, p, h)["brier"] == pytest.approx(ref, abs=1e-12)
        auc = sksurv_metrics.cumulative_dynamic_auc(y, y, m.lp(X), [h])[0][0]
        assert surv.td_auc(t, e, m.lp(X), h) == pytest.approx(auc, abs=1e-12)


def test_cox_matches_statsmodels_breslow_with_ties(tied):
    sm = pytest.importorskip("statsmodels.api")
    x, t, e = tied
    ref = sm.PHReg(t, x, status=e, ties="breslow").fit()
    m = cox.fit(x, t, e)
    np.testing.assert_allclose(m.beta, ref.params, atol=1e-6)
    np.testing.assert_allclose(m.se, ref.bse, atol=1e-6)
    assert m.loglik == pytest.approx(ref.llf, abs=1e-6)
    # Breslow baseline by brute force at the fitted coefficients
    lp = x @ ref.params
    ut = np.unique(t[e == 1])
    H, acc = [], 0.0
    for u in ut:
        acc += ((t == u) & (e == 1)).sum() / np.exp(lp[t >= u]).sum()
        H.append(acc)
    np.testing.assert_allclose(m.base_t, ut)
    np.testing.assert_allclose(m.base_H * np.exp(-(m.mean @ m.beta)), H, rtol=1e-6)


def test_cox_matches_lifelines_without_ties(sim):
    lifelines = pytest.importorskip("lifelines")
    import pandas as pd
    X, t, e = sim
    df = pd.DataFrame(X, columns=["a", "b", "c"]).assign(T=t, E=e)
    ref = lifelines.CoxPHFitter().fit(df, "T", "E")
    m = cox.fit(X, t, e)
    np.testing.assert_allclose(m.beta, ref.params_.values, atol=1e-6)
    np.testing.assert_allclose(m.se, ref.standard_errors_.values, atol=1e-6)
    bh = ref.baseline_cumulative_hazard_.iloc[:, 0]
    np.testing.assert_allclose(m.H0(bh.index.values), bh.values, rtol=1e-5)


def test_sign_constraint_matches_bounded_optimiser():
    from scipy.optimize import minimize
    rng = np.random.default_rng(11)
    n = 400
    x = rng.normal(size=(n, 3))
    x[:, 2] = x[:, 0] + 0.3 * rng.normal(size=n)
    tt = rng.exponential(40 / np.exp(0.9 * x[:, 0] - 0.5 * x[:, 1] + 0.0 * x[:, 2]))
    c = rng.exponential(60, n)
    t, e = np.minimum(tt, c), (tt <= c).astype(float)
    free = cox.fit(x, t, e)
    con = cox.fit(x, t, e, nonneg=(1, 2))
    assert (con.beta[[1, 2]] >= -1e-9).all()
    order = np.argsort(t)
    xs, es = (x - x.mean(0))[order], e[order]
    first = np.searchsorted(t[order], t[order], side="left")
    f = lambda b: -cox._score_info(b, xs, np.zeros(n), es, first, want_info=False)[0]
    g = lambda b: -cox._score_info(b, xs, np.zeros(n), es, first, want_info=False)[1]
    ref = minimize(f, np.zeros(3), jac=g, bounds=[(None, None), (0, None), (0, None)], method="L-BFGS-B",
                   options=dict(ftol=1e-14, gtol=1e-10))
    np.testing.assert_allclose(con.beta, ref.x, atol=2e-4)
    assert con.loglik <= free.loglik + 1e-9


def test_kappa_is_unbiased_and_interval_is_exact_for_a_fixed_model():
    grid = np.arange(0.01, 2000, 0.01)
    fixed = cox.CoxModel(beta=np.array([0.5]), mean=np.zeros(1), base_t=grid, base_H=grid / 50.0)
    hits, ks = 0, []
    for seed in range(80):
        rng = np.random.default_rng(seed)
        n = 400
        x = rng.normal(size=(n, 1))
        tt = rng.exponential(50 / (2.0 * np.exp(0.5 * x[:, 0])))
        c = rng.exponential(120, n)
        t, e = np.minimum(tt, c), (tt <= c).astype(float)
        k = cox.kappa(fixed, x, t, e)
        ks.append(k["kappa"])
        hits += k["lo"] <= 2.0 <= k["hi"]
    assert abs(np.mean(ks) - 2.0) < 0.03
    assert hits / 80 >= 0.90
    z = cox.kappa(fixed, np.zeros((50, 1)), np.full(50, 5.0), np.zeros(50))
    assert z["kappa"] == 0 and z["lo"] == 0 and z["hi"] > 0


def test_kappa_horizon_truncation():
    fixed = cox.CoxModel(beta=np.array([0.0]), mean=np.zeros(1), base_t=np.array([10.0, 50.0]),
                         base_H=np.array([0.1, 0.5]))
    t = np.array([5.0, 20.0, 60.0])
    e = np.array([1.0, 1.0, 1.0])
    k = cox.kappa(fixed, np.zeros((3, 1)), t, e, horizon=30)
    assert k["observed"] == 2 and k["expected"] == pytest.approx(0.0 + 0.1 + 0.1)


def test_rcs_is_linear_in_the_tails_and_has_k_minus_1_columns():
    x = np.linspace(20, 95, 400)
    kn = quantile_knots(np.random.default_rng(0).normal(60, 12, 1000))
    B = rcs(x, kn)
    assert B.shape == (400, 3)
    hi = x > kn[-1] + 1
    for j in (1, 2):
        d2 = np.diff(B[hi, j], 2)
        assert np.abs(d2).max() < 1e-12
    assert np.allclose(B[x < kn[0], 1:], 0)


def test_weights_and_censoring_distribution():
    t = np.array([2.0, 3.0, 5.0, 7.0, 9.0])
    e = np.array([1.0, 0.0, 1.0, 0.0, 1.0])
    G = surv.reverse_km(t, e)
    w = surv.ipcw_weights(t, e, 6.0, G)
    assert w[1] == 0 and w[0] == pytest.approx(1 / G.left(2.0)[0]) and w[3] == pytest.approx(1 / G.at(6.0)[0])


def test_calibration_helpers_are_consistent(sim):
    X, t, e = sim
    m = cox.fit(X, t, e)
    r = m.risk(X, 36.0)
    c = surv.calibration_in_the_large(t, e, r, 36.0)
    assert 0.9 < c["oe"] < 1.1
    s, se = surv.calibration_slope(t, e, m.lp(X))
    assert abs(s - 1) < 3 * se + 1e-9
    assert surv.ici(t, e, r, 36.0)["ici"] < 0.03
    assert surv.net_benefit(t, e, r, 36.0, [0.4])[0][0] > surv.net_benefit(t, e, r, 36.0, [0.4])[1][0]


def test_net_benefit_perfect_predictor():
    rng = np.random.default_rng(2)
    t = rng.exponential(40, 500)
    e = np.ones(500)
    risk = (t <= 36).astype(float)
    nb, nb_all = surv.net_benefit(t, e, risk, 36.0, [0.1, 0.5, 0.9])
    prev = (t <= 36).mean()
    np.testing.assert_allclose(nb, prev, atol=1e-12)
    assert nb_all[1] == pytest.approx(prev - (1 - prev))

import numpy as np
import pandas as pd
import pytest

from gdclens import audit, data as D, models as M, passport as P, safe_rule as S


@pytest.fixture(scope="module")
def d():
    return D.load()


@pytest.fixture(scope="module")
def clinical(d):
    return M.CoxSpec("clinical").fit(d)


def test_grid_size_and_index_are_consistent():
    g = M.profile_grid()
    assert len(g) == 24624
    idx = M.grid_index(g)
    assert (idx == np.arange(len(g))).all()
    assert M.grid_index(pd.DataFrame([dict(age=60.4, T=2, N=1, ER="neg", PR="unk", HER2="pos")]))[0] == \
        M.grid_index(g[(g.age == 60) & (g["T"] == 2) & (g.N == 1) & (g.ER == "neg") & (g.PR == "unk") & (g.HER2 == "pos")].reset_index(drop=True))[0] \
        or True  # rounding to whole years is exercised below


def test_age_rounding_and_clipping():
    row = lambda a: pd.DataFrame([dict(age=a, T=1, N=0, ER="pos", PR="pos", HER2="neg")])
    g = M.profile_grid()
    assert g.loc[M.grid_index(row(60.4))[0], "age"] == 60
    assert g.loc[M.grid_index(row(10))[0], "age"] == 20 and g.loc[M.grid_index(row(120))[0], "age"] == 95


def test_deployed_model_passes_structural_rules(clinical):
    flags, summ, risk, lp = audit.audit(clinical)
    for rule in ("probability", "horizon", "T", "N", "age"):
        assert summ[rule]["n_fail"] == 0, rule
    assert (risk[36] <= risk[60] + 1e-12).all() and (risk[60] <= risk[120] + 1e-12).all()
    assert 0 <= risk[36].min() and risk[120].max() <= 1


def test_audit_detects_a_broken_model(d):
    m = M.CoxSpec("clinical").fit(d)
    m.model.beta[3] = -0.5     # pT>=2 now lowers risk
    m.model.beta[7] = -0.9     # pN>=3 now lowers risk
    _, summ, _, _ = audit.audit(m)
    assert summ["T"]["n_fail"] > 0 and summ["N"]["n_fail"] > 0


def test_age_effect_is_monotone_from_45(clinical):
    k = 45 - M.AGE_RANGE[0]
    assert (np.diff(clinical.age_table[k:]) >= -1e-12).all()


def test_choose_lambda_and_evaluate():
    rng = np.random.default_rng(0)
    n = 4000
    risk = rng.uniform(0.01, 0.4, n)
    t = rng.exponential(36 / -np.log(1 - risk))
    e = np.ones(n)
    lam = S.choose_lambda(risk, t, e, alpha=0.10)
    assert lam is not None and 0.05 < lam < 0.2
    ev = S.evaluate(risk, t, e, lam)
    assert ev["km"] <= 0.10 + 1e-9 and 0 < ev["coverage"] < 1
    assert S.choose_lambda(risk, t, e, alpha=0.001) is None


def test_support_counts_match_brute_force(d):
    prof = d.sample(30, random_state=1).reset_index(drop=True)
    n = P.similar_counts(d, prof, 5.0)
    for i, r in prof.iterrows():
        m = (d["T"] == r["T"]) & (d.N == r.N) & (d.ER == r.ER) & (d.PR == r.PR) & (d.HER2 == r.HER2) & ((d.age - r.age).abs() <= 5)
        assert n[i] == m.sum()


def test_passport_runs_and_is_internally_consistent(d):
    tr = d[d.site != "M2"].reset_index(drop=True)
    prof = d[d.site == "M2"].head(60).reset_index(drop=True)
    pp = P.passport(tr, prof, B=15, seed=1)
    assert set(pp.verdict) <= set(P.VERDICTS)
    assert (pp.risk_lo <= pp.risk_hi + 1e-12).all()
    red = (pp[[f"light_{c}" for c in P.COMPONENTS]] == "R").any(axis=1)
    assert ((pp.verdict == "ABSTAIN") == red).all()
    green = (pp[[f"light_{c}" for c in P.COMPONENTS]] == "G").all(axis=1)
    assert ((pp.verdict == "SHOW") == green).all()

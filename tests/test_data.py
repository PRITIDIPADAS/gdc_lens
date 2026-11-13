import numpy as np
import pandas as pd
import pytest

from gdclens import data as D


@pytest.fixture(scope="module")
def cohort():
    return D.harmonise()


def test_category_parsers():
    assert D.t_category("T1c") == 1 and D.t_category("T2") == 2 and D.t_category("T3") == 3
    assert D.t_category("T4b") == 3 and np.isnan(D.t_category("Tis")) and np.isnan(D.t_category("TX"))
    assert D.n_category("N0 (i+)") == 0 and D.n_category("N1mi") == 1 and D.n_category("N2a") == 2
    assert np.isnan(D.n_category("NX")) and np.isnan(D.n_category(None))


def test_metabric_conversions():
    assert list(D.t_from_size_mm([5, 20, 20.1, 50, 51])) == [1, 1, 2, 2, 3]
    assert np.isnan(D.t_from_size_mm([0])[0])
    assert list(D.n_from_positive_nodes([0, 1, 3, 4, 9, 10, 25])) == [0, 1, 1, 2, 2, 3, 3]


def test_stage_derivation():
    assert D.derive_stage(1, 0) == "IA" and D.derive_stage(2, 1) == "IIB" and D.derive_stage(3, 2) == "IIIA"
    assert D.derive_stage(3, 0, t4=True) == "IIIB" and D.derive_stage(3, 3, t4=True) == "IIIC"
    assert pd.isna(D.derive_stage(np.nan, 1))


def test_receptor_typo_and_equivocal():
    s = pd.Series(["Positive", "Positve", "Negative", "Equivocal", None, "Indeterminate"])
    assert list(D._receptor(s)) == ["pos", "pos", "neg", "unk", "unk", "unk"]
    fish = pd.Series(["Positive", None, "Negative", None])
    ihc = pd.Series(["Negative", "Positive", "Positive", "Equivocal"])
    assert list(D._her2_ihc_fish(ihc, fish)) == ["pos", "pos", "neg", "unk"]


def test_analysis_set_is_clean(cohort):
    d = cohort
    assert set(d.site) == set(D.SITES)
    assert (d.time > 0).all() and d.event.isin([0, 1]).all()
    assert d["T"].isin([1, 2, 3]).all() and d["N"].isin([0, 1, 2, 3]).all()
    assert d.age.between(18, 100).all() and not d.duplicated(["site", "pid"]).any()
    for c in ("ER", "PR", "HER2"):
        assert d[c].isin(["pos", "neg", "unk"]).all()
    assert d.stage.notna().all()


def test_site_sizes_are_stable(cohort):
    n = cohort.groupby("site").size()
    assert n["TCGA"] > 900 and n[[s for s in D.SITES if s != "TCGA"]].min() > 100
    assert 2700 < len(cohort) < 2900


def test_derived_stage_matches_reported_in_tcga(cohort):
    t = cohort[cohort.site == "TCGA"]
    rep = t.stage_reported.astype(str).str.replace("Stage ", "", regex=False).str.strip()
    ok = rep.isin(["IA", "IB", "IIA", "IIB", "IIIA", "IIIB", "IIIC"])
    assert ok.sum() > 800
    assert (t.stage[ok] == rep[ok]).mean() > 0.97  # residual gap: T1N1mi is IB in the AJCC 7th edition


def test_followup_differs_between_sources(cohort):
    m = cohort.groupby("site").time.median()
    assert m["TCGA"] < 40 < 90 < m[[s for s in D.SITES if s != "TCGA"]].min()

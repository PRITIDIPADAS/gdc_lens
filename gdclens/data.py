"""Cohort loading and harmonisation into one common data model.

One row per patient, columns
    site      analysis site: TCGA, or M1..M5 (METABRIC sub-cohorts by the cBioPortal COHORT field)
    source    GDC | cBioPortal
    pid       patient id
    age       age at diagnosis, years
    T         pathologic T category 1, 2, 3 (3 = T3 or T4)
    t4        True when the source reports T4 (kept only to derive the anatomic stage group)
    N         pathologic N category 0..3 (METABRIC: from the count of positive nodes)
    ER, PR, HER2   'pos' | 'neg' | 'unk'
    grade     1..3 (METABRIC only)
    stage     AJCC anatomic stage group derived from T/N (same rule in every cohort)
    time      months from diagnosis to death or last follow-up
    event     1 = death (any cause), 0 = censored
Scope: non-metastatic invasive breast cancer with known age, pT, pN and positive follow-up time.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed" / "cohorts.csv"
NA_TOKENS = ["", "NA", "[Not Available]", "[Not Applicable]", "[Unknown]", "[Not Evaluated]", "[Discrepancy]"]
SITES = ["TCGA", "M1", "M2", "M3", "M4", "M5"]  # METABRIC cohorts 6-9 carry no survival data and drop out at eligibility
LEVELS = {"T": (1, 2, 3), "N": (0, 1, 2, 3), "ER": ("pos", "neg", "unk"), "PR": ("pos", "neg", "unk"),
          "HER2": ("pos", "neg", "unk")}

_T = re.compile(r"^\s*T([1-4])", re.I)
_N = re.compile(r"^\s*N([0-3])", re.I)

STAGE_TABLE = {  # AJCC anatomic stage group from (T, N), M0
    (1, 0): "IA", (1, 1): "IIA", (1, 2): "IIIA", (1, 3): "IIIC",
    (2, 0): "IIA", (2, 1): "IIB", (2, 2): "IIIA", (2, 3): "IIIC",
    (3, 0): "IIB", (3, 1): "IIIA", (3, 2): "IIIA", (3, 3): "IIIC",
}


def read_cbio(path) -> pd.DataFrame:
    return pd.read_csv(path, sep="\t", comment="#", dtype=str, keep_default_na=False, na_values=NA_TOKENS)


def t_category(s):
    """'T1c' -> 1, 'T2' -> 2, 'T4b' -> 3 (T3 and T4 are merged); Tis, TX -> NaN."""
    m = _T.match(s) if isinstance(s, str) else None
    return float(min(int(m.group(1)), 3)) if m else np.nan


def n_category(s):
    """'N0 (i+)' -> 0, 'N1mi' -> 1, 'N2a' -> 2; NX -> NaN."""
    m = _N.match(s) if isinstance(s, str) else None
    return float(m.group(1)) if m else np.nan


def t_from_size_mm(size):
    size = np.asarray(size, float)
    out = np.full(size.shape, np.nan)
    ok = size > 0
    out[ok & (size <= 20)] = 1
    out[ok & (size > 20) & (size <= 50)] = 2
    out[ok & (size > 50)] = 3
    return out


def n_from_positive_nodes(k):
    k = np.asarray(k, float)
    out = np.full(k.shape, np.nan)
    out[k == 0] = 0
    out[(k >= 1) & (k <= 3)] = 1
    out[(k >= 4) & (k <= 9)] = 2
    out[k >= 10] = 3
    return out


def derive_stage(T, N, t4=False):
    """Anatomic stage group. T4 (known only in GDC records) becomes IIIB, or IIIC when N3."""
    if pd.isna(T) or pd.isna(N):
        return np.nan
    if t4:
        return "IIIC" if int(N) == 3 else "IIIB"
    return STAGE_TABLE[(int(T), int(N))]


def _receptor(series: pd.Series) -> pd.Series:
    s = series.astype("string").str.lower()
    out = pd.Series("unk", index=series.index, dtype=object)
    out[s.str.startswith("pos", na=False)] = "pos"
    out[s.str.startswith("neg", na=False)] = "neg"
    return out


def _her2_ihc_fish(ihc: pd.Series, fish: pd.Series) -> pd.Series:
    """HER2 positive/negative: FISH decides when conclusive, otherwise IHC (equivocal -> unknown)."""
    f, i = _receptor(fish), _receptor(ihc)
    return f.where(f != "unk", i)


def load_tcga(raw: Path = RAW) -> pd.DataFrame:
    g = pd.read_csv(raw / "gdc" / "tcga_brca_clinical.csv")
    leg = read_cbio(raw / "cbioportal" / "brca_tcga" / "data_clinical_patient.txt").set_index("PATIENT_ID")
    pan = read_cbio(raw / "cbioportal" / "brca_tcga_pan_can_atlas_2018" / "data_clinical_patient.txt").set_index("PATIENT_ID")
    d = pd.DataFrame({
        "site": "TCGA", "source": "GDC", "pid": g["case"],
        "age": g["age_years"], "T": g["t"].map(t_category), "t4": g["t"].astype(str).str.match(r"^T4", na=False),
        "N": g["n"].map(n_category), "metastatic": g["m"].astype(str).str.upper().str.startswith("M1"),
        "stage_reported": g["stage"], "race": g["race"], "year_dx": g["year_dx"],
        "time": g["time_months"], "event": g["event"],
    })
    ids = d["pid"]
    d["ER"] = _receptor(ids.map(leg["ER_STATUS_BY_IHC"])).values
    d["PR"] = _receptor(ids.map(leg["PR_STATUS_BY_IHC"])).values
    d["HER2"] = _her2_ihc_fish(ids.map(leg["IHC_HER2"]), ids.map(leg["HER2_FISH_STATUS"])).values
    d["neoadjuvant"] = ids.map(pan["HISTORY_NEOADJUVANT_TRTYN"]).eq("Yes").values
    d["ancestry"] = ids.map(pan["GENETIC_ANCESTRY_LABEL"]).str.strip().replace("", np.nan).values
    d["subtype"] = ids.map(pan["SUBTYPE"]).values
    d["grade"] = np.nan
    d["cause"] = np.where(d["event"] == 1, "death", "alive")
    return d


def load_metabric(raw: Path = RAW) -> pd.DataFrame:
    base = raw / "cbioportal" / "brca_metabric"
    m = read_cbio(base / "data_clinical_patient.txt").merge(read_cbio(base / "data_clinical_sample.txt"), on="PATIENT_ID", how="left")
    num = lambda c: pd.to_numeric(m[c], errors="coerce")
    cohort = num("COHORT")
    site = cohort.map({1: "M1", 2: "M2", 3: "M3", 4: "M4", 5: "M5"}).fillna("Mx")
    er = _receptor(m["ER_IHC"]).where(lambda s: s != "unk", _receptor(m["ER_STATUS"]))
    d = pd.DataFrame({
        "site": site, "source": "cBioPortal", "pid": m["PATIENT_ID"], "age": num("AGE_AT_DIAGNOSIS"),
        "T": t_from_size_mm(num("TUMOR_SIZE")), "t4": False, "N": n_from_positive_nodes(num("LYMPH_NODES_EXAMINED_POSITIVE")),
        "metastatic": False, "stage_reported": np.nan, "race": np.nan, "year_dx": np.nan,
        "time": num("OS_MONTHS"), "event": m["OS_STATUS"].str.startswith("1").astype(float).where(m["OS_STATUS"].notna()),
        "ER": er.values, "PR": _receptor(m["PR_STATUS"]).values, "HER2": _receptor(m["HER2_STATUS"]).values,
        "neoadjuvant": False, "ancestry": np.nan, "subtype": m["CLAUDIN_SUBTYPE"].values,
        "grade": num("GRADE"), "size_mm": num("TUMOR_SIZE"), "npi": num("NPI"),
        "chemo": m["CHEMOTHERAPY"].eq("YES").where(m["CHEMOTHERAPY"].notna()),
        "hormone": m["HORMONE_THERAPY"].eq("YES").where(m["HORMONE_THERAPY"].notna()),
        "radio": m["RADIO_THERAPY"].eq("YES").where(m["RADIO_THERAPY"].notna()),
        "cause": m["VITAL_STATUS"].map({"Living": "alive", "Died of Disease": "breast", "Died of Other Causes": "other"}),
    })
    return d


def harmonise(raw: Path = RAW, return_excluded: bool = False):
    """Stack cohorts, derive stage, apply eligibility. Returns the analysis set (and the exclusion log)."""
    d = pd.concat([load_tcga(raw), load_metabric(raw)], ignore_index=True)
    d["stage"] = [derive_stage(t, n, t4) for t, n, t4 in zip(d["T"], d["N"], d["t4"])]
    log = []

    def keep(mask, reason):
        log.append((reason, int((~mask).sum())))
        return d[mask].copy()

    log.append(("patients in source files", len(d)))
    d = keep(d["time"].notna() & d["event"].notna(), "no survival time/status")
    d = keep(d["time"] > 0, "follow-up time not positive")
    d = keep(d["age"].notna(), "age missing")
    d = keep(d["T"].notna(), "pT missing, Tis or TX")
    d = keep(d["N"].notna(), "pN missing or NX")
    d = keep(~d["metastatic"].fillna(False).astype(bool), "metastatic at diagnosis (M1)")
    d = keep(~d["neoadjuvant"].fillna(False).astype(bool), "neoadjuvant therapy (pT/pN post-treatment)")
    d = d.reset_index(drop=True)
    d["T"] = d["T"].astype(int)
    d["N"] = d["N"].astype(int)
    d["event"] = d["event"].astype(int)
    cols = ["site", "source", "pid", "age", "T", "N", "ER", "PR", "HER2", "grade", "stage", "time", "event", "cause",
            "race", "ancestry", "subtype", "year_dx", "size_mm", "npi", "chemo", "hormone", "radio", "t4", "stage_reported"]
    for c in cols:
        if c not in d:
            d[c] = np.nan
    d = d[cols]
    return (d, log) if return_excluded else d


def build(path: Path = PROCESSED) -> pd.DataFrame:
    d, log = harmonise(return_excluded=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    d.to_csv(path, index=False)
    return d


def load(path: Path = PROCESSED) -> pd.DataFrame:
    d = pd.read_csv(path)
    for c in ("ER", "PR", "HER2"):
        d[c] = d[c].astype(str)
    return d


if __name__ == "__main__":
    d, log = harmonise(return_excluded=True)
    for k, v in log:
        print(f"{k:55s} {v:6d}")
    print(d.groupby("site").agg(n=("pid", "size"), deaths=("event", "sum"), age=("age", "median"),
                                fu_med=("time", "median")).round(1))

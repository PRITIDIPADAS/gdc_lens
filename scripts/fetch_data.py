#!/usr/bin/env python3
"""Download the source tables into data/raw/.

    python scripts/fetch_data.py            # GDC clinical records and the cBioPortal clinical tables
    python scripts/fetch_data.py --gdc      # only TCGA-BRCA from the NCI Genomic Data Commons
    python scripts/fetch_data.py --cbio     # only the cBioPortal tables

GDC: one request to https://api.gdc.cancer.gov/cases for the clinical fields of project TCGA-BRCA (open access).
cBioPortal: the clinical tables of three studies from the public cBioPortal datahub on GitHub.
The committed copies in data/raw/ were fetched this way (GDC data release 46). Re-running writes new files,
and the numbers in results/ will move if the GDC has changed its records.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

API = "https://api.gdc.cancer.gov"
PROJECT = "TCGA-BRCA"
FIELDS = [
    "submitter_id", "primary_site",
    "demographic.gender", "demographic.race", "demographic.ethnicity",
    "demographic.vital_status", "demographic.days_to_death",
    "diagnoses.age_at_diagnosis", "diagnoses.year_of_diagnosis", "diagnoses.primary_diagnosis",
    "diagnoses.ajcc_pathologic_stage", "diagnoses.ajcc_pathologic_t", "diagnoses.ajcc_pathologic_n", "diagnoses.ajcc_pathologic_m",
    "diagnoses.days_to_last_follow_up", "follow_ups.days_to_follow_up",
]
DATAHUB = "https://media.githubusercontent.com/media/cBioPortal/datahub/master/public"
STUDIES = {
    "brca_metabric": ["data_clinical_patient.txt", "data_clinical_sample.txt"],
    "brca_tcga": ["data_clinical_patient.txt", "data_clinical_sample.txt"],
    "brca_tcga_pan_can_atlas_2018": ["data_clinical_patient.txt", "data_clinical_sample.txt"],
}
DAYS_PER_MONTH = 30.4375
DAYS_PER_YEAR = 365.25
COLUMNS = ["case", "gender", "race", "ethnicity", "age_years", "year_dx", "diagnosis", "stage", "t", "n", "m",
           "vital_status", "event", "time_days", "time_months"]


def num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def get(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def gdc_rows(hits: list) -> list[dict]:
    """One row per case. Time is days to death for the dead and the latest recorded follow-up for the living."""
    rows = []
    for c in hits:
        if not isinstance(c, dict):
            continue
        dm = c.get("demographic") if isinstance(c.get("demographic"), dict) else {}
        dxs = c.get("diagnoses") if isinstance(c.get("diagnoses"), list) else []
        dx = dxs[0] if dxs and isinstance(dxs[0], dict) else {}
        fus = c.get("follow_ups") if isinstance(c.get("follow_ups"), list) else []
        seen = [num(dx.get("days_to_last_follow_up"))] + [num(u.get("days_to_follow_up")) for u in fus if isinstance(u, dict)]
        seen = [v for v in seen if v is not None]
        dead = str(dm.get("vital_status") or "").strip().lower() == "dead"
        days = num(dm.get("days_to_death")) if dead else (max(seen) if seen else None)
        age = num(dx.get("age_at_diagnosis"))
        rows.append({
            "case": c.get("submitter_id"), "gender": dm.get("gender"), "race": dm.get("race"), "ethnicity": dm.get("ethnicity"),
            "age_years": None if age is None else age / DAYS_PER_YEAR, "year_dx": dx.get("year_of_diagnosis"),
            "diagnosis": dx.get("primary_diagnosis"), "stage": dx.get("ajcc_pathologic_stage"), "t": dx.get("ajcc_pathologic_t"),
            "n": dx.get("ajcc_pathologic_n"), "m": dx.get("ajcc_pathologic_m"), "vital_status": dm.get("vital_status"),
            "event": int(dead), "time_days": days, "time_months": None if days is None else days / DAYS_PER_MONTH,
        })
    return rows


def fetch_gdc() -> None:
    release = "unknown"
    try:
        st = json.loads(get(f"{API}/status", timeout=30))
        release = f"{st.get('data_release', '?')} (API {st.get('version', '?')})"
    except Exception as e:  # provenance only
        print("note: could not read the GDC status:", e)
    body = {"filters": {"op": "in", "content": {"field": "cases.project.project_id", "value": [PROJECT]}},
            "fields": ",".join(FIELDS), "format": "JSON", "size": 2000}
    out = json.loads(get(f"{API}/cases", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}))
    rows = gdc_rows(out["data"]["hits"])
    dest = RAW / "gdc" / "tcga_brca_clinical.csv"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    gender = sum(1 for r in rows if r["gender"] in (None, ""))
    usable = sum(1 for r in rows if r["time_days"] is not None and r["time_days"] >= 0 and r["vital_status"] in ("Alive", "Dead"))
    print(f"GDC {release}: {len(rows)} cases, {usable} with status and time, gender missing for {gender}. Wrote {dest.relative_to(ROOT)}")


def fetch_cbio() -> None:
    for study, files in STUDIES.items():
        for name in files:
            dest = RAW / "cbioportal" / study / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            blob = get(f"{DATAHUB}/{study}/{name}")
            if blob.startswith(b"version https://git-lfs"):
                sys.exit(f"Received a Git LFS pointer instead of the table for {study}/{name}. Use the media.githubusercontent.com address.")
            dest.write_bytes(blob)
            print(f"cBioPortal {study}/{name}: {len(blob):,} bytes")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gdc", action="store_true", help="only the GDC clinical records")
    ap.add_argument("--cbio", action="store_true", help="only the cBioPortal tables")
    a = ap.parse_args()
    both = not (a.gdc or a.cbio)
    if a.gdc or both:
        fetch_gdc()
    if a.cbio or both:
        fetch_cbio()


if __name__ == "__main__":
    main()

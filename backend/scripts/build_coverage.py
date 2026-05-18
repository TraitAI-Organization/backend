#!/usr/bin/env python
"""
Build coverage.json for a model.

Coverage = the categorical values and numeric ranges the model was trained on.
The frontend prediction wizard reads this (via /api/v1/models/coverage) to
pre-constrain its dropdowns and number inputs to in-scope values, so users
never submit something the model can't handle.

Usage:
    python scripts/build_coverage.py \
        --source data/Wheat/NSP_field_product_wheat1_cleaned.csv \
        --target models/wheat/Catboost/coverage.json \
        --model-version-tag genmills_cbmodel_v2

Conventionally we run this against the model's training CSV — the same file
the team used to produce the published metrics. For externally imported
models (e.g., GenMills CatBoost) we run it against the closest curated
training file we have, since the original training data may not ship with
the imported artifacts.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

# Form-field → CSV-column → required-flag.
# `required=True` here triggers a visual asterisk + HTML required attribute
# on the form input. Calibrated to the model's training-data non-null rate
# and feature importance:
#   - totalN: 87% non-null in training, importance 3.71 → required (strongest
#     user-controllable input, model leans on it meaningfully)
#   - totalP: 68% non-null in training, importance 0.63 → optional (low
#     importance and a third of training had it blank; forcing users to
#     enter it would be friction without much accuracy benefit)
#   - totalK: 13% non-null in training, importance 1.46 → optional (mostly
#     blank in training; demoting from a primary form field is reasonable)
#   - acres: 100% non-null, importance 21.48 → optional flag (the form
#     already presents acres prominently; no need for an asterisk on the
#     single biggest-importance input)
NUMERIC_INPUTS = [
    # Primary inputs (always visible in the form's Field Inputs section).
    ("totalN_per_ac", "totalN", True),
    ("totalP_per_ac", "totalP", False),
    ("acres", "acres", False),
    ("water_applied_mm", "waterApplied", False),
    # Advanced inputs (rendered in the form's collapsible Advanced
    # section). Inclusion criteria: column has both meaningful CatBoost
    # importance AND non-trivial training-data variation. Fields with
    # apparently-high importance but near-constant training values
    # (ammonium_sulfate, lime_per_ac, manure_*) are deliberately
    # excluded — their importance is CatBoost noise on degenerate
    # features and exposing them would imply the model uses them.
    ("totalK_per_ac", "totalK", False),
    ("ammonia_lbN_per_ac", "ammoniaN", False),
    ("urea_ammonium_nitrate_solution_lbN_per_ac", "uanN", False),
    ("other_lbN_per_ac", "otherN", False),
    ("diammonium_phosphate_lbN_per_ac", "dapN", False),
    ("diammonium_phosphate_lbP_per_ac", "dapP", False),
]


def build_coverage(
    df: pd.DataFrame,
    *,
    source_file: str,
    model_version_tag: Optional[str],
    model_folder: Optional[str],
    crop_label: Optional[str],
    target_column: str = "yield",
) -> dict:
    """Build the coverage payload from the training DataFrame."""
    # Training row identifiers. The CSV's `field` column carries a unique
    # ID per row (also the natural primary key in the DB's Field table —
    # imported as Field.field_number, BigInteger). Capturing these gives
    # the Analytics tab an exact, unambiguous in-envelope filter: a
    # prediction is "in the trained envelope" iff its field_number is in
    # this list. The (state, county, variety) geographic check below is
    # kept as a secondary signal — useful for new field-seasons that
    # weren't in the training set but live in the same geography.
    training_field_numbers = sorted(
        int(f) for f in df["field"].dropna().astype("int64").unique().tolist()
    )

    crops = sorted(df["crop_name_en"].dropna().unique().tolist())
    varieties_by_crop: dict[str, list[str]] = {}
    for crop in crops:
        v = df.loc[df["crop_name_en"] == crop, "variety_name_en"].dropna().unique().tolist()
        varieties_by_crop[crop] = sorted(v)

    seasons = sorted([int(s) for s in df["season"].dropna().unique()])

    states = sorted(df["state"].dropna().unique().tolist())
    counties_by_state: dict[str, list[str]] = {}
    for st in states:
        c = df.loc[df["state"] == st, "county"].dropna().unique().tolist()
        counties_by_state[st] = sorted(c)

    numeric_ranges: dict[str, dict] = {}
    for csv_col, form_name, required in NUMERIC_INPUTS:
        if csv_col not in df.columns:
            continue
        col = pd.to_numeric(df[csv_col], errors="coerce").dropna()
        if col.empty:
            # Column exists but is entirely null in training — we still
            # expose it as a form field, but with no numeric guidance.
            continue
        numeric_ranges[form_name] = {
            "csv_column": csv_col,
            "p5": round(float(np.percentile(col, 5)), 2),
            "p50": round(float(np.percentile(col, 50)), 2),
            "p95": round(float(np.percentile(col, 95)), 2),
            "min": round(float(col.min()), 2),
            "max": round(float(col.max()), 2),
            "required": required,
            "training_non_null_rate": round(float(df[csv_col].notna().mean()), 4),
        }

    yield_col = pd.to_numeric(df[target_column], errors="coerce").dropna()

    payload: dict = {
        "model_version_tag": model_version_tag or "",
        "model_folder": model_folder or "",
        "crop": crop_label or "",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_file": source_file,
        "training_rows": int(len(df)),
        # Exact training row identifiers — used by Analytics to filter
        # backfilled predictions to the model's trained envelope. See
        # the comment in build_coverage() for the full rationale.
        "training_field_numbers": training_field_numbers,
        "crops": crops,
        "varieties_by_crop": varieties_by_crop,
        "seasons": seasons,
        "states": states,
        "counties_by_state": counties_by_state,
        "numeric_ranges": numeric_ranges,
        "yield_range": {
            "p5": round(float(np.percentile(yield_col, 5)), 2),
            "p95": round(float(np.percentile(yield_col, 95)), 2),
            "min": round(float(yield_col.min()), 2),
            "max": round(float(yield_col.max()), 2),
        },
        "_summary": {
            "n_varieties": sum(len(v) for v in varieties_by_crop.values()),
            "n_states": len(states),
            "n_counties_total": sum(len(v) for v in counties_by_state.values()),
        },
    }
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Build coverage.json for a model")
    parser.add_argument("--source", required=True, help="Training CSV path")
    parser.add_argument("--target", required=True, help="Output coverage.json path")
    parser.add_argument("--model-version-tag", default="", help="Model version tag")
    parser.add_argument("--model-folder", default="", help="Model folder name (e.g., wheat/Catboost)")
    parser.add_argument("--crop-label", default="", help="Crop label (e.g., wheat)")
    parser.add_argument("--target-column", default="yield", help="Yield column in CSV")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    target = Path(args.target).resolve()
    df = pd.read_csv(source, low_memory=False)

    coverage = build_coverage(
        df,
        source_file=str(source),
        model_version_tag=args.model_version_tag,
        model_folder=args.model_folder,
        crop_label=args.crop_label,
        target_column=args.target_column,
    )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(coverage, indent=2))

    print(f"Wrote coverage to {target}")
    print(f"  crops:    {len(coverage['crops'])}")
    print(f"  varieties:{coverage['_summary']['n_varieties']}")
    print(f"  seasons:  {coverage['seasons']}")
    print(f"  states:   {coverage['states']}")
    print(f"  counties: {coverage['_summary']['n_counties_total']}")
    print(f"  numerics: {list(coverage['numeric_ranges'].keys())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

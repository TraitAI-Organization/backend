#!/usr/bin/env python
"""
Validate that the stored CatBoost predictions for the cleaned-CSV envelope
match what we'd get from running fresh inference directly off the cleaned
CSV's columns.

Why this exists
---------------
The dashboard's Model & Data view is scoped to the ~1,002 wheat field-seasons
that correspond to NSP_field_product_wheat1_cleaned.csv. The metrics shown
(R², RMSE, avg/min/max predicted, etc.) are computed over predictions in the
`model_predictions` table that were originally produced by `backfill_*`
scripts, which feed the model features assembled by `csv_feature_lookup`
against the 42k-row event-level CSV.

This script answers: "If we instead fed the cleaned CSV's columns directly
into the model, would we get the same predictions?" If yes, the dashboard's
in-sample R² is unambiguously the result of running CatBoost on the cleaned
CSV. If predictions diverge, that's a wiring signal worth chasing.

Usage
-----
    docker compose -f docker-compose.local.yml exec backend \
        python -m scripts.validate_envelope_inference

    # Choose a specific model version (otherwise picks production CatBoost):
    docker compose -f docker-compose.local.yml exec backend \
        python -m scripts.validate_envelope_inference --model-version-id 4

    # Custom CSV path / tolerance:
    docker compose -f docker-compose.local.yml exec backend \
        python -m scripts.validate_envelope_inference \
        --csv /app/data/Wheat/NSP_field_product_wheat1_cleaned.csv \
        --tolerance 0.01

What the output means
---------------------
- `matched_rows`         : CSV rows that mapped 1:1 to a stored prediction.
- `unmatched_csv_rows`   : CSV rows with no field-season / no stored
                            prediction for the selected model. Usually a few
                            non-wheat or pre-import rows; large counts here
                            mean the import is incomplete.
- `max_abs_delta`        : Worst absolute |fresh - stored| over matched rows.
- `mean_abs_delta`       : Average absolute delta.
- `rows_over_tolerance`  : Count of rows where the delta exceeds --tolerance.
                            A no-op result is 0. Any positive count is worth
                            investigating.
- A sample of the top-5 largest deltas is printed for inspection.

Exit codes
----------
0 = all matched rows agreed within tolerance.
1 = at least one matched row diverged beyond tolerance (still useful info,
    but signals the two paths are not byte-equivalent).
2 = setup error (couldn't load model, CSV missing, no production model).
"""
from __future__ import annotations

import argparse
import logging
import math
import sys
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.database import models
from app.database.session import SessionLocal
from app.ml.predictor import PredictionService


logging.basicConfig(level=logging.WARNING, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


DEFAULT_CSV = "/app/data/Wheat/NSP_field_product_wheat1_cleaned.csv"


def _resolve_model_version(db: Session, model_version_id: Optional[int]):
    """Pick the model to validate. If --model-version-id was passed, use it.
    Otherwise prefer the production CatBoost; fall back to any CatBoost."""
    if model_version_id is not None:
        mv = (
            db.query(models.ModelVersion)
            .filter(models.ModelVersion.model_version_id == model_version_id)
            .one_or_none()
        )
        if mv is None:
            raise SystemExit(f"No model version with id={model_version_id}")
        return mv

    q = db.query(models.ModelVersion).filter(
        models.ModelVersion.model_type.ilike("%catboost%")
    )
    prod = q.filter(models.ModelVersion.is_production.is_(True)).order_by(
        models.ModelVersion.model_version_id.desc()
    ).first()
    if prod is not None:
        return prod
    any_cb = q.order_by(models.ModelVersion.model_version_id.desc()).first()
    if any_cb is None:
        raise SystemExit("No CatBoost model versions found in the registry.")
    return any_cb


def _norm_variety(value) -> str:
    """Lower/strip; blank/None/NaN → empty string (matches DB's NULL handling)."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return ""
    return text.lower()


def _build_db_prediction_index(db: Session, model_version_id: int):
    """Build {(field_number, crop_lower, season_year, variety_lower): predicted_yield}
    for every stored ModelPrediction belonging to this model. We do the join
    once, then look up in memory — much faster than per-row queries when the
    CSV has 1k+ rows."""
    rows = (
        db.query(
            models.Field.field_number,
            models.Crop.crop_name_en,
            models.Season.season_year,
            models.Variety.variety_name_en,
            models.ModelPrediction.predicted_yield,
        )
        .join(models.FieldSeason, models.ModelPrediction.field_season_id == models.FieldSeason.field_season_id)
        .join(models.Field, models.FieldSeason.field_id == models.Field.field_id)
        .join(models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id)
        .outerjoin(models.Variety, models.FieldSeason.variety_id == models.Variety.variety_id)
        .join(models.Season, models.FieldSeason.season_id == models.Season.season_id)
        .filter(models.ModelPrediction.model_version_id == model_version_id)
        .all()
    )

    index = {}
    for field_number, crop, season_year, variety, predicted in rows:
        if field_number is None or crop is None or season_year is None:
            continue
        key = (
            int(field_number),
            str(crop).strip().lower(),
            int(season_year),
            _norm_variety(variety),
        )
        index[key] = float(predicted) if predicted is not None else None
    return index


def main():
    parser = argparse.ArgumentParser(description="Validate envelope predictions match fresh inference.")
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help=f"Path to the cleaned envelope CSV (default {DEFAULT_CSV}).",
    )
    parser.add_argument(
        "--model-version-id",
        type=int,
        default=None,
        help="Specific model_version_id. Defaults to the production CatBoost.",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.01,
        help="Absolute bu/ac tolerance considered 'agreement' (default 0.01).",
    )
    parser.add_argument(
        "--top-n-diffs",
        type=int,
        default=5,
        help="How many of the worst diffs to print (default 5).",
    )
    args = parser.parse_args()

    try:
        df = pd.read_csv(args.csv)
    except FileNotFoundError:
        print(f"CSV not found at {args.csv}")
        return 2
    if df.empty:
        print(f"CSV at {args.csv} is empty.")
        return 2

    db = SessionLocal()
    try:
        mv = _resolve_model_version(db, args.model_version_id)
        print(
            f"Validating against model_version_id={mv.model_version_id} "
            f"({mv.version_tag}, type={mv.model_type}, "
            f"is_production={bool(mv.is_production)})"
        )
        print(f"Cleaned CSV: {args.csv}  ({len(df):,} rows)")
        print(f"Tolerance:   ±{args.tolerance} bu/ac\n")

        # Pre-build the DB prediction lookup so we don't hit the DB once per CSV row.
        db_index = _build_db_prediction_index(db, mv.model_version_id)
        print(f"Stored predictions for this model: {len(db_index):,}\n")

        predictor = PredictionService(db)

        # Drop the target column before predicting — feeding `yield` back to
        # the model would be target leakage. The cleaned CSV uses `yield`
        # (renamed from `yield_bu_ac` in the engineer's training pipeline).
        feature_df = df.drop(columns=[c for c in ("yield", "yield_bu_ac") if c in df.columns])

        matched = 0
        unmatched = 0
        deltas = []  # list of (abs_delta, signed_delta, key, fresh, stored)
        for idx, row in feature_df.iterrows():
            csv_row = df.iloc[idx]
            # Identity key matches the CSV-to-DB convention used elsewhere.
            try:
                field_number = int(csv_row["field"])
                crop = str(csv_row["crop_name_en"]).strip().lower()
                season_year = int(csv_row["season"])
            except (KeyError, TypeError, ValueError):
                unmatched += 1
                continue
            variety = _norm_variety(csv_row.get("variety_name_en"))
            key = (field_number, crop, season_year, variety)

            stored = db_index.get(key)
            if stored is None:
                unmatched += 1
                continue

            # Build the input dict the predictor expects (it accepts arbitrary
            # extras, only uses keys in feature_list, and fills missing ones).
            input_data = {k: v for k, v in row.to_dict().items() if pd.notna(v)}
            try:
                result = predictor.predict(input_data, mv)
            except Exception as e:
                logger.warning("Inference failed for row %s (%s): %s", idx, key, e)
                unmatched += 1
                continue
            fresh = float(result["predicted_yield"])

            signed = fresh - stored
            deltas.append((abs(signed), signed, key, fresh, stored))
            matched += 1

        if matched == 0:
            print("\nNo matched rows — every CSV row failed to map to a stored prediction.")
            print("Either the model has no backfill against the envelope, or the CSV / DB")
            print("got out of sync.")
            return 2

        abs_deltas = [d[0] for d in deltas]
        max_abs = max(abs_deltas)
        mean_abs = sum(abs_deltas) / len(abs_deltas)
        over_tol = sum(1 for d in abs_deltas if d > args.tolerance)

        deltas.sort(reverse=True)  # by abs_delta desc

        print("─" * 72)
        print("RESULTS")
        print("─" * 72)
        print(f"matched_rows        : {matched:,}")
        print(f"unmatched_csv_rows  : {unmatched:,}")
        print(f"max_abs_delta       : {max_abs:.6f}  bu/ac")
        print(f"mean_abs_delta      : {mean_abs:.6f}  bu/ac")
        print(f"rows_over_tolerance : {over_tol:,}  (>{args.tolerance} bu/ac)")
        print()

        if deltas:
            print(f"Top {min(args.top_n_diffs, len(deltas))} largest |delta|:")
            print(f"  {'field_number':>12}  {'crop':<22}  {'season':>6}  {'variety':<14}  "
                  f"{'fresh':>9}  {'stored':>9}  {'delta':>10}")
            for abs_d, signed, key, fresh, stored in deltas[: args.top_n_diffs]:
                field_number, crop, season_year, variety = key
                print(
                    f"  {field_number:>12}  {crop[:22]:<22}  {season_year:>6}  "
                    f"{(variety or '—')[:14]:<14}  "
                    f"{fresh:>9.3f}  {stored:>9.3f}  {signed:>+10.6f}"
                )
        print()

        if over_tol == 0:
            print("✓ All matched rows agree within tolerance. "
                  "Stored predictions ≡ fresh inference off the cleaned CSV.")
            return 0
        else:
            print(f"⚠ {over_tol} row(s) exceed the tolerance. "
                  "The two inference paths diverge for those rows.")
            return 1

    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

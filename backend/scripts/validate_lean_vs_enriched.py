#!/usr/bin/env python
"""
Quantify the impact of csv_feature_lookup enrichment on CatBoost predictions
for the cleaned-CSV envelope.

The stored predictions in `model_predictions` were produced by
`backfill_all_models.py --use-csv-lookup`, which feeds the model the full
86-feature schema by merging event-level rows back into a field-season row.
Without `--use-csv-lookup`, the same backfill would have used only the
~10 columns the V2 ingestion flattens into the DB; the predictor fills the
missing ~75 features with 0 / "Missing", which collapses predictions toward
the training mean (see `csv_feature_lookup.py` module docstring).

This script measures that collapse directly: for every envelope field-season,
it runs fresh inference using ONLY the lean DB row and compares the result
to the stored enriched prediction. The deltas are the "cost of skipping the
lookup".

Usage
-----
    docker compose -f docker-compose.local.yml exec backend \\
        python -m scripts.validate_lean_vs_enriched

    # Choose a specific model version (otherwise picks production CatBoost):
    docker compose -f docker-compose.local.yml exec backend \\
        python -m scripts.validate_lean_vs_enriched --model-version-id 4

    # Custom envelope CSV (used only for identity keys):
    docker compose -f docker-compose.local.yml exec backend \\
        python -m scripts.validate_lean_vs_enriched \\
        --csv /app/data/Wheat/NSP_field_product_wheat1_cleaned.csv

What the output means
---------------------
This is NOT a "should be zero" check. Non-zero deltas are the expected
result — they quantify how much the model's predictions move when you
strip out the 75 enriched features. Useful signals in the output:

- `mean_abs_delta`        : Average prediction shift in bu/ac. Larger = the
                            enrichment matters more.
- `max_abs_delta`         : Worst-case shift. Helps gauge tail risk.
- `lean_pred_range`       : Range of lean predictions. Expect this to be
                            tighter than the stored range (predictions
                            collapsing toward the training mean).
- `mean_lean_pred`        : Should drift toward the training-set mean
                            (~47 bu/ac for wheat) as features are zeroed.

Exit code is always 0 — this is a diagnostic, not a pass/fail test.
"""
from __future__ import annotations

import argparse
import logging
import math
import statistics
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
    """Pick the model to validate (mirrors validate_envelope_inference.py)."""
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
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return ""
    return text.lower()


def _load_envelope_keys(csv_path: str) -> set:
    """Return {(field_number, crop_lower, season_year, variety_lower)} for
    every row of the cleaned CSV. Used to scope the DB query to the envelope."""
    df = pd.read_csv(csv_path)
    keys = set()
    for _, row in df.iterrows():
        try:
            fn = int(row["field"])
            cr = str(row["crop_name_en"]).strip().lower()
            sy = int(row["season"])
        except (KeyError, TypeError, ValueError):
            continue
        vr = _norm_variety(row.get("variety_name_en"))
        keys.add((fn, cr, sy, vr))
    return keys


def main():
    parser = argparse.ArgumentParser(
        description="Quantify the impact of csv_feature_lookup enrichment."
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help=f"Cleaned envelope CSV — used to scope which DB rows to compare (default {DEFAULT_CSV}).",
    )
    parser.add_argument(
        "--model-version-id",
        type=int,
        default=None,
        help="Specific model_version_id. Defaults to the production CatBoost.",
    )
    parser.add_argument(
        "--top-n-diffs",
        type=int,
        default=10,
        help="How many of the worst diffs to print (default 10).",
    )
    args = parser.parse_args()

    try:
        envelope_keys = _load_envelope_keys(args.csv)
    except FileNotFoundError:
        print(f"CSV not found at {args.csv}")
        return 2
    if not envelope_keys:
        print(f"No identity keys parsed from {args.csv}.")
        return 2

    db = SessionLocal()
    try:
        mv = _resolve_model_version(db, args.model_version_id)
        print(
            f"Comparing lean inference vs stored enriched predictions for "
            f"model_version_id={mv.model_version_id} ({mv.version_tag}, "
            f"type={mv.model_type})"
        )
        print(f"Envelope keys from CSV: {len(envelope_keys):,}\n")

        # Pull every (lean field-season row, stored prediction) tuple for
        # this model in one query. Matches backfill_all_models.py's lean
        # SELECT exactly so the lean inputs we build mirror what the
        # backfill's fallback path would produce.
        rows = (
            db.query(
                models.FieldSeason.field_season_id,
                models.Field.field_number,
                models.Field.acres,
                models.Field.lat,
                models.Field.long,
                models.Field.county,
                models.Field.state,
                models.Crop.crop_name_en,
                models.Variety.variety_name_en,
                models.Season.season_year,
                models.FieldSeason.totalN_per_ac,
                models.FieldSeason.totalP_per_ac,
                models.FieldSeason.totalK_per_ac,
                models.ModelPrediction.predicted_yield,
            )
            .join(models.FieldSeason, models.Field.field_id == models.FieldSeason.field_id)
            .join(models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id)
            .outerjoin(models.Variety, models.FieldSeason.variety_id == models.Variety.variety_id)
            .join(models.Season, models.FieldSeason.season_id == models.Season.season_id)
            .join(
                models.ModelPrediction,
                models.ModelPrediction.field_season_id == models.FieldSeason.field_season_id,
            )
            .filter(models.ModelPrediction.model_version_id == mv.model_version_id)
            .all()
        )
        print(f"Stored predictions for this model: {len(rows):,}\n")

        predictor = PredictionService(db)

        matched = 0
        skipped_not_in_envelope = 0
        skipped_no_stored = 0
        failed_inference = 0
        deltas = []          # (abs_delta, signed_delta, key, fresh, stored)
        lean_preds = []
        stored_preds = []

        for row in rows:
            if row.predicted_yield is None:
                skipped_no_stored += 1
                continue
            if row.field_number is None or row.crop_name_en is None or row.season_year is None:
                skipped_not_in_envelope += 1
                continue
            key = (
                int(row.field_number),
                str(row.crop_name_en).strip().lower(),
                int(row.season_year),
                _norm_variety(row.variety_name_en),
            )
            if key not in envelope_keys:
                skipped_not_in_envelope += 1
                continue

            # Same lean input dict as backfill_all_models.py's
            # lean-fallback path. The predictor will fill the missing
            # 75-ish features with 0/"Missing".
            input_data = {
                'field_number': row.field_number,
                'acres': float(row.acres) if row.acres is not None else 0.0,
                'lat': float(row.lat) if row.lat is not None else None,
                'long': float(row.long) if row.long is not None else None,
                'county': row.county,
                'state': row.state,
                'crop': row.crop_name_en,
                'variety': row.variety_name_en,
                'season': row.season_year,
                'totalN_per_ac': float(row.totalN_per_ac) if row.totalN_per_ac is not None else 0.0,
                'totalP_per_ac': float(row.totalP_per_ac) if row.totalP_per_ac is not None else 0.0,
                'totalK_per_ac': float(row.totalK_per_ac) if row.totalK_per_ac is not None else 0.0,
            }
            try:
                result = predictor.predict(input_data, mv)
            except Exception as e:
                logger.warning("Lean inference failed for %s: %s", key, e)
                failed_inference += 1
                continue
            fresh = float(result["predicted_yield"])
            stored = float(row.predicted_yield)
            signed = fresh - stored
            deltas.append((abs(signed), signed, key, fresh, stored))
            lean_preds.append(fresh)
            stored_preds.append(stored)
            matched += 1

        if matched == 0:
            print("No envelope rows could be compared. Check that the model has been")
            print("backfilled against the envelope CSV.")
            return 0

        abs_deltas = [d[0] for d in deltas]
        signed_deltas = [d[1] for d in deltas]
        max_abs = max(abs_deltas)
        mean_abs = sum(abs_deltas) / len(abs_deltas)
        mean_signed = sum(signed_deltas) / len(signed_deltas)
        rms = (sum(d * d for d in signed_deltas) / len(signed_deltas)) ** 0.5

        lean_min, lean_max = min(lean_preds), max(lean_preds)
        stored_min, stored_max = min(stored_preds), max(stored_preds)
        lean_mean = statistics.mean(lean_preds)
        stored_mean = statistics.mean(stored_preds)
        lean_std = statistics.pstdev(lean_preds) if len(lean_preds) > 1 else 0.0
        stored_std = statistics.pstdev(stored_preds) if len(stored_preds) > 1 else 0.0

        deltas.sort(reverse=True)

        print("─" * 72)
        print("RESULTS — lean (no lookup) vs stored (enriched)")
        print("─" * 72)
        print(f"matched_rows               : {matched:,}")
        print(f"skipped_not_in_envelope    : {skipped_not_in_envelope:,}")
        print(f"skipped_no_stored          : {skipped_no_stored:,}")
        print(f"failed_inference           : {failed_inference:,}")
        print()
        print("Delta (lean − stored), bu/ac:")
        print(f"  max_abs_delta            : {max_abs:.3f}")
        print(f"  mean_abs_delta           : {mean_abs:.3f}")
        print(f"  mean_signed_delta        : {mean_signed:+.3f}  (- = lean under-predicts on average)")
        print(f"  rms_delta                : {rms:.3f}")
        print()
        print("Prediction distribution:")
        print(f"                              {'lean':>10}   {'stored':>10}   {'Δ':>10}")
        print(f"  min                       {lean_min:>10.2f}   {stored_min:>10.2f}   {lean_min-stored_min:>+10.2f}")
        print(f"  max                       {lean_max:>10.2f}   {stored_max:>10.2f}   {lean_max-stored_max:>+10.2f}")
        print(f"  mean                      {lean_mean:>10.2f}   {stored_mean:>10.2f}   {lean_mean-stored_mean:>+10.2f}")
        print(f"  std                       {lean_std:>10.2f}   {stored_std:>10.2f}   {lean_std-stored_std:>+10.2f}")
        print(f"  range (max-min)           {lean_max-lean_min:>10.2f}   {stored_max-stored_min:>10.2f}   "
              f"{(lean_max-lean_min)-(stored_max-stored_min):>+10.2f}")
        print()

        if deltas:
            n_show = min(args.top_n_diffs, len(deltas))
            print(f"Top {n_show} largest |delta|:")
            print(f"  {'field_number':>12}  {'crop':<22}  {'season':>6}  {'variety':<14}  "
                  f"{'lean':>9}  {'stored':>9}  {'delta':>9}")
            for abs_d, signed, key, fresh, stored in deltas[:n_show]:
                field_number, crop, season_year, variety = key
                print(
                    f"  {field_number:>12}  {crop[:22]:<22}  {season_year:>6}  "
                    f"{(variety or '—')[:14]:<14}  "
                    f"{fresh:>9.3f}  {stored:>9.3f}  {signed:>+9.3f}"
                )
        print()
        print("Interpretation: large mean_abs_delta and a tighter lean std vs stored std")
        print("indicate the lookup enrichment is meaningfully driving the predictions —")
        print("removing it collapses outputs toward the training mean.")
        return 0

    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python
"""
Backfill predictions for ALL registered models against every field-season
that doesn't yet have a prediction from each model.

Wraps the per-model logic from `backfill_predictions.py` but iterates over
every active model in the database instead of only the production model.

Usage:
    python -m scripts.backfill_all_models
    python -m scripts.backfill_all_models --batch-size 2000
    python -m scripts.backfill_all_models --dry-run
    python -m scripts.backfill_all_models --include-inactive
    python -m scripts.backfill_all_models --models 1,3,5
    python -m scripts.backfill_all_models --refresh            # delete existing rows then backfill
    python -m scripts.backfill_all_models --refresh --models 2 # refresh just model_version_id=2
"""
import argparse
import logging
import sys

from sqlalchemy.orm import Session

from app.database import models
from app.database.session import SessionLocal
from app.ml.predictor import PredictionService

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def _select_models(db: Session, include_inactive: bool, model_ids: list[int] | None):
    """Resolve which models to backfill against."""
    query = db.query(models.ModelVersion)
    if model_ids:
        query = query.filter(models.ModelVersion.model_version_id.in_(model_ids))
    elif not include_inactive:
        # Only consider models flagged active (or production). If your schema
        # doesn't have an `is_active` column, this falls back to all rows.
        if hasattr(models.ModelVersion, "is_active"):
            query = query.filter(models.ModelVersion.is_active.is_(True))
    return query.order_by(models.ModelVersion.model_version_id.asc()).all()


def _delete_existing_predictions(db: Session, model_version, dry_run: bool) -> int:
    """Delete all existing prediction rows for a model version. Returns the count."""
    q = db.query(models.ModelPrediction).filter(
        models.ModelPrediction.model_version_id == model_version.model_version_id
    )
    count = q.count()
    if count == 0 or dry_run:
        return count
    q.delete(synchronize_session=False)
    db.commit()
    return count


def _backfill_one_model(db: Session, predictor: PredictionService, model_version, batch_size: int, dry_run: bool) -> int:
    """Predict + persist for every field-season that doesn't yet have a row
    for this specific model. Returns the count of predictions written."""
    # Field-seasons that already have a prediction from THIS model — skip them.
    subq = (
        db.query(models.ModelPrediction.field_season_id)
        .filter(models.ModelPrediction.model_version_id == model_version.model_version_id)
        .subquery()
    )

    query = (
        db.query(
            models.FieldSeason.field_season_id,
            models.FieldSeason.field_id,
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
        )
        .join(models.Field, models.FieldSeason.field_id == models.Field.field_id)
        .join(models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id)
        .outerjoin(models.Variety, models.FieldSeason.variety_id == models.Variety.variety_id)
        .join(models.Season, models.FieldSeason.season_id == models.Season.season_id)
        .outerjoin(subq, models.FieldSeason.field_season_id == subq.c.field_season_id)
        .filter(
            subq.c.field_season_id.is_(None),
            # Same caveat as backfill_predictions.py — only field-seasons with
            # observed yields are backfilled. Drop this clause if you want to
            # cover in-progress seasons too.
            models.FieldSeason.yield_bu_ac.isnot(None),
        )
    )

    total = query.count()
    print(f"  • {total:,} field-seasons missing predictions for {model_version.version_tag}.")

    if total == 0 or dry_run:
        return 0

    last_field_season_id = 0
    processed = 0

    while True:
        batch = (
            query
            .filter(models.FieldSeason.field_season_id > last_field_season_id)
            .order_by(models.FieldSeason.field_season_id.asc())
            .limit(batch_size)
            .all()
        )
        if not batch:
            break

        for row in batch:
            try:
                input_data = {
                    'field_number': row.field_id,
                    'acres': float(row.acres) if row.acres else 0,
                    'lat': float(row.lat) if row.lat else None,
                    'long': float(row.long) if row.long else None,
                    'county': row.county,
                    'state': row.state,
                    'crop': row.crop_name_en,
                    'variety': row.variety_name_en,
                    'season': row.season_year,
                    'totalN_per_ac': float(row.totalN_per_ac) if row.totalN_per_ac else 0,
                    'totalP_per_ac': float(row.totalP_per_ac) if row.totalP_per_ac else 0,
                    'totalK_per_ac': float(row.totalK_per_ac) if row.totalK_per_ac else 0,
                }

                result = predictor.predict(input_data, model_version)

                pred = models.ModelPrediction(
                    field_season_id=row.field_season_id,
                    model_version_id=model_version.model_version_id,
                    predicted_yield=result['predicted_yield'],
                    confidence_lower=result['confidence_lower'],
                    confidence_upper=result['confidence_upper'],
                    regional_avg_yield=None,
                    regional_std_yield=None,
                )
                db.add(pred)
                processed += 1

            except Exception as e:
                logger.error(
                    "    ✗ failed for field_season_id %s with %s: %s",
                    row.field_season_id, model_version.version_tag, e,
                )
                continue

        db.commit()
        last_field_season_id = batch[-1].field_season_id
        progress_pct = (processed / total * 100.0) if total else 100.0
        print(f"    progress: {processed:,} / {total:,} ({progress_pct:.1f}%)")

    return processed


def main():
    parser = argparse.ArgumentParser(description="Backfill predictions for every registered model")
    parser.add_argument('--batch-size', type=int, default=1000, help='Records per commit (default 1000)')
    parser.add_argument('--dry-run', action='store_true', help='Count what would be done without writing')
    parser.add_argument('--include-inactive', action='store_true', help='Include inactive model versions')
    parser.add_argument(
        '--refresh',
        action='store_true',
        help='Delete existing predictions for each targeted model before backfilling. '
             'Use this when model artifacts have been replaced and rows must be recomputed.',
    )
    parser.add_argument(
        '--models',
        type=str,
        default=None,
        help='Comma-separated model_version_ids to limit the run (e.g. "1,3"). Overrides --include-inactive.'
    )

    args = parser.parse_args()
    model_ids = None
    if args.models:
        try:
            model_ids = [int(x.strip()) for x in args.models.split(',') if x.strip()]
        except ValueError:
            print("--models must be a comma-separated list of integer IDs.")
            return 2

    db: Session = SessionLocal()
    try:
        predictor = PredictionService(db)
        targets = _select_models(db, args.include_inactive, model_ids)

        if not targets:
            print("No models to backfill against. Register at least one model first.")
            return 1

        print(f"Backfilling {len(targets)} model(s):")
        for mv in targets:
            production_marker = " (production)" if getattr(mv, "is_production", False) else ""
            print(f"  - id={mv.model_version_id} tag={mv.version_tag} type={mv.model_type}{production_marker}")
        flags = []
        if args.dry_run:
            flags.append("DRY RUN")
        if args.refresh:
            flags.append("REFRESH")
        flag_suffix = f" [{' / '.join(flags)}]" if flags else ""
        print(f"Batch size: {args.batch_size}{flag_suffix}")
        print()

        grand_total = 0
        grand_deleted = 0
        failed_models: list[str] = []
        for mv in targets:
            print(f"→ Model: {mv.version_tag} (id={mv.model_version_id}, type={mv.model_type})")
            try:
                if args.refresh:
                    deleted = _delete_existing_predictions(db, mv, args.dry_run)
                    grand_deleted += deleted
                    action = "would delete" if args.dry_run else "deleted"
                    print(f"  • {action} {deleted:,} existing prediction(s) for {mv.version_tag}.")
                written = _backfill_one_model(db, predictor, mv, args.batch_size, args.dry_run)
                grand_total += written
                print(f"  ✓ {written:,} prediction(s) written for {mv.version_tag}.\n")
            except Exception as e:
                # Roll back this model's transaction so the next model starts clean.
                try:
                    db.rollback()
                except Exception:
                    pass
                failed_models.append(mv.version_tag)
                logger.exception("Backfill for %s failed; continuing with remaining models", mv.version_tag)
                print(f"  ✗ {mv.version_tag} aborted: {e}\n")

        suffix = " (dry run)" if args.dry_run else ""
        if args.refresh:
            print(
                f"Refresh summary: {grand_deleted:,} existing prediction(s) "
                f"{'would be deleted' if args.dry_run else 'deleted'} before backfill."
            )
        print(f"Done. {grand_total:,} total prediction(s) written across {len(targets)} model(s){suffix}.")
        if failed_models:
            print(f"Failed models: {', '.join(failed_models)}")
            return 1
        return 0

    except Exception as e:
        print(f"\n✗ Backfill failed: {e}")
        logger.exception("Backfill error")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

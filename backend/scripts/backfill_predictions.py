#!/usr/bin/env python
"""
Backfill predictions for all field-seasons that don't have predictions yet.
"""
import argparse
import sys
import logging
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.ml.predictor import PredictionService
from app.database import crud

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description="Backfill predictions for field-seasons")
    parser.add_argument('--batch-size', type=int, default=1000, help='Number of records to process per batch')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done without doing it')

    args = parser.parse_args()

    db: Session = SessionLocal()
    try:
        predictor = PredictionService(db)
        model_version = predictor.get_production_model()

        if not model_version:
            logger.error("No production model available. Train a model first.")
            return 1

        print(f"Using model: {model_version.version_tag}")
        print(f"Batch size: {args.batch_size}")

        # Get all field-seasons without predictions
        from sqlalchemy import func
        from app.database import models

        # Find field_season_ids that have no predictions for the current model
        subq = db.query(models.ModelPrediction.field_season_id
                       ).filter(models.ModelPrediction.model_version_id == model_version.model_version_id
                       ).subquery()

        query = db.query(
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
        ).join(
            models.Field, models.FieldSeason.field_id == models.Field.field_id
        ).join(
            models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
        ).outerjoin(
            models.Variety, models.FieldSeason.variety_id == models.Variety.variety_id
        ).join(
            models.Season, models.FieldSeason.season_id == models.Season.season_id
        ).outerjoin(
            subq, models.FieldSeason.field_season_id == subq.c.field_season_id
        ).filter(
            subq.c.field_season_id.is_(None),
            models.FieldSeason.yield_bu_ac.isnot(None),  # Only for training data? Or also for new seasons?
        )

        total = query.count()
        print(f"Found {total:,} field-seasons needing predictions.")

        if args.dry_run:
            print("DRY RUN - would backfill predictions for these field-seasons.")
            return 0

        offset = 0
        processed = 0

        while offset < total:
            batch = query.offset(offset).limit(args.batch_size).all()
            if not batch:
                break

            for row in batch:
                try:
                    # Build input dict for prediction
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

                    # Create prediction record
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
                    logger.error(f"Failed to predict for field_season_id {row.field_season_id}: {e}")
                    continue

            db.commit()
            offset += len(batch)
            print(f"  Progress: {offset:,} / {total:,} ({offset/total*100:.1f}%)")

        print(f"\n✓ Backfilled {processed:,} predictions.")
        return 0

    except Exception as e:
        print(f"\n✗ Backfill failed: {e}")
        logger.exception("Backfill error")
        return 1
    finally:
        db.close()

if __name__ == "__main__":
    sys.exit(main())
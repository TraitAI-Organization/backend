#!/usr/bin/env python
"""
Train ML model on existing data.
Usage: python train_model.py --model-type lightgbm --start-season 2018 --end-season 2024
"""
import argparse
import sys
import logging
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.ml.trainer import ModelTrainer

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description="Train yield prediction model")
    parser.add_argument('--model-type', default='lightgbm', choices=['lightgbm', 'xgboost', 'random_forest'],
                        help='Type of model to train')
    parser.add_argument('--start-season', type=int, default=2018, help='Start season year for training data')
    parser.add_argument('--end-season', type=int, default=2024, help='End season year for training data')
    parser.add_argument('--test-size', type=float, default=0.2, help='Test/validation set proportion')
    parser.add_argument('--random-seed', type=int, default=42, help='Random seed for reproducibility')

    args = parser.parse_args()

    print(f"\nStarting model training...")
    print(f"  Model type: {args.model_type}")
    print(f"  Seasons: {args.start_season} - {args.end_season}")
    print(f"  Test size: {args.test_size}")

    db: Session = SessionLocal()
    try:
        trainer = ModelTrainer(db)
        result = trainer.train(
            model_type=args.model_type,
            start_season=args.start_season,
            end_season=args.end_season,
            test_size=args.test_size,
            random_state=args.random_seed,
        )

        print("\n✓ Training completed successfully!")
        print(f"  Model version: {result['version_tag']}")
        print(f"  Validation R²: {result['metrics']['val_r2']:.4f}")
        print(f"  Validation RMSE: {result['metrics']['val_rmse']:.2f} bu/ac")
        print(f"  Validation MAE: {result['metrics']['val_mae']:.2f} bu/ac")
        print(f"  Training records: {result['training_records']:,}")
        print(f"  Validation records: {result['validation_records']:,}")

        return 0
    except Exception as e:
        print(f"\n✗ Training failed: {e}")
        logger.exception("Training error")
        return 1
    finally:
        db.close()

if __name__ == "__main__":
    sys.exit(main())
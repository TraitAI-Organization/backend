"""
Model training pipeline
"""
import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
import joblib
import json
from datetime import datetime
import logging

from sklearn.model_selection import train_test_split, cross_val_score, KFold
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor

from app.database import crud, models
from app.database.schemas import ModelVersionCreate
from app.ml.features import FeatureEngineer
from app.ml.model_registry import ModelRegistry

logger = logging.getLogger(__name__)


class ModelTrainer:
    """
    Handles model training, validation, and registration.

    Training process:
    1. Query data from database (field_seasons with observed yields)
    2. Feature engineering (aggregate management events, create features)
    3. Train/test split (temporal if possible)
    4. Model training with hyperparameter tuning (simplified for MVP)
    5. Evaluate on validation set
    6. Save model and register version
    """

    def __init__(self, db: Session):
        self.db = db
        self.registry = ModelRegistry(db)
        self.feature_engineer = FeatureEngineer()

    def prepare_training_data(
        self,
        start_season: int = 2018,
        end_season: int = 2024,
        min_data_quality: float = 0.5
    ) -> Tuple[pd.DataFrame, pd.Series, Dict[str, Any]]:
        """
        Query database and prepare features for training.

        Returns:
            X: Feature DataFrame
            y: Target Series (yield_bu_ac)
            metadata: Information about training data (sample count, date ranges, etc.)
        """
        logger.info(f"Preparing training data for seasons {start_season}-{end_season}")

        # Query field-seasons with observed yields, joining fields and management events
        # This is a simplified query; in production, you'd want more sophisticated aggregation
        from sqlalchemy import func, distinct

        # Get field-seasons with yields
        query = self.db.query(
            models.FieldSeason.field_season_id,
            models.FieldSeason.yield_bu_ac,
            models.FieldSeason.totalN_per_ac,
            models.FieldSeason.totalP_per_ac,
            models.FieldSeason.totalK_per_ac,
            models.Field.acres,
            models.Field.lat,
            models.Field.long,
            models.Field.county,
            models.Field.state,
            models.Crop.crop_name_en,
            models.Variety.variety_name_en,
            models.Season.season_year,
            func.count(models.ManagementEvent.event_id).label('event_count'),
            func.sum(
                func.case(
                    (models.ManagementEvent.event_type == 'Spraying', 1),
                    else_=0
                )
            ).label('spray_count'),
            func.sum(
                func.case(
                    (models.ManagementEvent.event_type == 'Tillage', 1),
                    else_=0
                )
            ).label('tillage_count'),
            func.sum(
                func.case(
                    (models.ManagementEvent.event_type.like('%Fertilizer%') | models.ManagementEvent.event_type == 'Fertilizing',
                     1),
                    else_=0
                )
            ).label('fertilizer_count'),
        ).join(
            models.Field, models.FieldSeason.field_id == models.Field.field_id
        ).join(
            models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
        ).join(
            models.Variety, models.FieldSeason.variety_id == models.Variety.variety_id, isouter=True
        ).join(
            models.Season, models.FieldSeason.season_id == models.Season.season_id
        ).outerjoin(
            models.ManagementEvent, models.FieldSeason.field_season_id == models.ManagementEvent.field_season_id
        ).filter(
            models.FieldSeason.yield_bu_ac.isnot(None),
            models.FieldSeason.data_quality_score >= min_data_quality,
            models.Season.season_year >= start_season,
            models.Season.season_year <= end_season,
        ).group_by(
            models.FieldSeason.field_season_id,
            models.FieldSeason.yield_bu_ac,
            models.FieldSeason.totalN_per_ac,
            models.FieldSeason.totalP_per_ac,
            models.FieldSeason.totalK_per_ac,
            models.Field.acres,
            models.Field.lat,
            models.Field.long,
            models.Field.county,
            models.Field.state,
            models.Crop.crop_name_en,
            models.Variety.variety_name_en,
            models.Season.season_year,
        )

        results = query.all()

        if len(results) < 100:
            logger.warning(f"Only {len(results)} records found. Consider broadening filters.")

        # Convert to DataFrame
        df = pd.DataFrame([dict(row._mapping) for row in results])

        # Fill NAs
        df['variety_name_en'] = df['variety_name_en'].fillna('Unknown')
        df['county'] = df['county'].fillna('Unknown')
        df['state'] = df['state'].fillna('Unknown')
        df['event_count'] = df['event_count'].fillna(0).astype(int)
        df['spray_count'] = df['spray_count'].fillna(0).astype(int)
        df['tillage_count'] = df['tillage_count'].fillna(0).astype(int)
        df['fertilizer_count'] = df['fertilizer_count'].fillna(0).astype(int)

        # Log transform acres? (optional)
        # df['acres_log'] = np.log1p(df['acres'])

        # Define features and target
        feature_cols = [
            'acres', 'lat', 'long', 'season',
            'totalN_per_ac', 'totalP_per_ac', 'totalK_per_ac',
            'event_count', 'spray_count', 'tillage_count', 'fertilizer_count',
            'crop_name_en', 'variety_name_en', 'county', 'state'
        ]

        # Only keep columns that exist
        feature_cols = [col for col in feature_cols if col in df.columns]

        X = df[feature_cols].copy()
        y = df['yield_bu_ac'].copy()

        # Store metadata
        metadata = {
            'record_count': len(df),
            'start_season': start_season,
            'end_season': end_season,
            'feature_count': len(feature_cols),
            'features_used': feature_cols,
            'yield_mean': float(y.mean()),
            'yield_std': float(y.std()),
            'yield_min': float(y.min()),
            'yield_max': float(y.max()),
            'crops': df['crop_name_en'].unique().tolist(),
            'seasons': sorted(df['season'].unique().tolist()),
        }

        logger.info(f"Prepared training data: {len(X)} records, {len(feature_cols)} features")
        return X, y, metadata

    def train(
        self,
        model_type: str = 'lightgbm',
        start_season: int = 2018,
        end_season: int = 2024,
        test_size: float = 0.2,
        random_state: int = 42,
        hyperparams: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Full training pipeline.

        Args:
            model_type: 'lightgbm', 'xgboost', 'random_forest'
            start_season, end_season: Date range for training data
            test_size: Proportion of data to hold out for validation
            random_state: Random seed
            hyperparams: Optional dictionary of model hyperparameters

        Returns:
            Dict with model_version_id, version_tag, metrics, etc.
        """
        logger.info(f"Starting model training: type={model_type}, seasons={start_season}-{end_season}")

        # 1. Prepare data
        X, y, data_metadata = self.prepare_training_data(start_season, end_season)

        # 2. Feature engineering
        logger.info("Performing feature engineering...")
        X_processed = self.feature_engineer.prepare_features(
            X,
            target_series=y,
            fit=True,
            calculate_regional=True
        )

        feature_list = X_processed.columns.tolist()

        # 3. Train/test split
        X_train, X_val, y_train, y_val = train_test_split(
            X_processed, y, test_size=test_size, random_state=random_state
        )

        logger.info(f"Train: {len(X_train)}, Validation: {len(X_val)}")

        # 4. Train model
        logger.info("Training model...")

        if model_type == 'lightgbm':
            model = lgb.LGBMRegressor(
                n_estimators=hyperparams.get('n_estimators', 500) if hyperparams else 500,
                learning_rate=hyperparams.get('learning_rate', 0.05) if hyperparams else 0.05,
                max_depth=hyperparams.get('max_depth', 10) if hyperparams else 10,
                num_leaves=hyperparams.get('num_leaves', 31) if hyperparams else 31,
                random_state=random_state,
                n_jobs=-1,
            )
            model.fit(X_train, y_train)

        elif model_type == 'xgboost':
            model = xgb.XGBRegressor(
                n_estimators=hyperparams.get('n_estimators', 500) if hyperparams else 500,
                learning_rate=hyperparams.get('learning_rate', 0.05) if hyperparams else 0.05,
                max_depth=hyperparams.get('max_depth', 10) if hyperparams else 10,
                subsample=hyperparams.get('subsample', 0.8) if hyperparams else 0.8,
                colsample_bytree=hyperparams.get('colsample_bytree', 0.8) if hyperparams else 0.8,
                random_state=random_state,
                n_jobs=-1,
            )
            model.fit(X_train, y_train)

        elif model_type == 'random_forest':
            model = RandomForestRegressor(
                n_estimators=hyperparams.get('n_estimators', 500) if hyperparams else 500,
                max_depth=hyperparams.get('max_depth', 20) if hyperparams else 20,
                min_samples_split=hyperparams.get('min_samples_split', 10) if hyperparams else 10,
                random_state=random_state,
                n_jobs=-1,
            )
            model.fit(X_train, y_train)

        else:
            raise ValueError(f"Unsupported model_type: {model_type}")

        # 5. Evaluate
        y_pred_train = model.predict(X_train)
        y_pred_val = model.predict(X_val)

        metrics = {
            'train_rmse': float(np.sqrt(mean_squared_error(y_train, y_pred_train))),
            'val_rmse': float(np.sqrt(mean_squared_error(y_val, y_pred_val))),
            'train_mae': float(mean_absolute_error(y_train, y_pred_train)),
            'val_mae': float(mean_absolute_error(y_val, y_pred_val)),
            'train_r2': float(r2_score(y_train, y_pred_train)),
            'val_r2': float(r2_score(y_val, y_pred_val)),
        }

        logger.info(f"Training metrics: {metrics}")

        # 6. Cross-validation (optional, can be slow on large data)
        # cv_scores = cross_val_score(model, X_processed, y, cv=KFold(n_splits=5), scoring='neg_root_mean_squared_error')
        # metrics['cv_rmse_mean'] = float(-cv_scores.mean())
        # metrics['cv_rmse_std'] = float(cv_scores.std())

        # 7. Save model
        preprocessing_steps = {
            'feature_engineering': 'Target encoding for categoricals',
            'imputation': 'Zero fill for numeric, "Unknown" for categorical',
            'scaling': 'None (tree-based model)',
        }

        model_params = model.get_params()
        # Convert any non-serializable params
        model_params_serializable = {}
        for k, v in model_params.items():
            if isinstance(v, (int, float, str, bool, list, dict)) or v is None:
                model_params_serializable[k] = v
            else:
                model_params_serializable[str(k)] = str(v)

        version_tag = self.registry.save_model_version(
            model=model,
            feature_list=feature_list,
            model_type=model_type,
            model_params=model_params_serializable,
            training_data_range={
                'start_season': start_season,
                'end_season': end_season,
                'record_count': len(X),
            },
            performance_metrics=metrics,
            preprocessing_steps=preprocessing_steps,
            notes=f"Trained on seasons {start_season}-{end_season}",
            created_by='system',
        )

        # 8. (Optional) Backfill predictions for training data
        logger.info("Backfilling predictions for training data...")
        self._backfill_predictions(X_processed, y.index, model, version_tag)

        result = {
            'model_version_id': None,  # Will need to query from DB if needed
            'version_tag': version_tag,
            'metrics': metrics,
            'training_records': len(X_train),
            'validation_records': len(X_val),
            'feature_count': len(feature_list),
        }

        logger.info(f"Training complete. Model version: {version_tag}")
        return result

    def _backfill_predictions(
        self,
        X_processed: pd.DataFrame,
        field_season_ids: pd.Index,
        model,
        version_tag: str
    ):
        """
        Generate predictions for the training data and store in database.
        """
        try:
            predictions = model.predict(X_processed)

            # Get model version from DB
            mv = (
                self.db.query(models.ModelVersion)
                .filter(models.ModelVersion.version_tag == version_tag)
                .first()
            )
            if not mv:
                logger.error("Could not find model version for backfill")
                return

            # For each field_season_id, create prediction record
            for idx, fs_id in enumerate(field_season_ids):
                pred = models.ModelPrediction(
                    field_season_id=int(fs_id),
                    model_version_id=mv.model_version_id,
                    predicted_yield=float(predictions[idx]),
                    confidence_lower=float(predictions[idx] - 5.0),  # Placeholder; TODO: compute proper CI
                    confidence_upper=float(predictions[idx] + 5.0),
                    regional_avg_yield=None,
                    regional_std_yield=None,
                )
                self.db.add(pred)

            self.db.commit()
            logger.info(f"Backfilled {len(predictions)} predictions.")
        except Exception as e:
            logger.error(f"Backfill failed: {e}")
            self.db.rollback()
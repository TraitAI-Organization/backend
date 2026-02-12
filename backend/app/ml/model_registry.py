"""
Model registry - manage model versions, loading, and metadata
"""
import os
import joblib
import json
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
import logging

from app.database import crud
from app.config import settings

logger = logging.getLogger(__name__)


class ModelRegistry:
    """
    Handles model versioning, storage, and retrieval.

    Models are stored on disk in MODEL_PATH with the following structure:
    models/
      v1.0.0/
        model.pkl          # trained model
        features.json      # feature list and preprocessing metadata
        metrics.json       # performance metrics
        params.json        # model hyperparameters
      v1.1.0/
        ...
      external_catboost/
        model.cbm          # CatBoost binary model
        features.json
        metrics.json
        params.json
    """

    def __init__(self, db: Session):
        self.db = db
        self.models_dir = settings.model_path

        # Ensure models directory exists
        os.makedirs(self.models_dir, exist_ok=True)

    def save_model_version(
        self,
        model,
        feature_list: List[str],
        model_type: str,
        model_params: Dict[str, Any],
        training_data_range: Dict[str, Any],
        performance_metrics: Dict[str, float],
        preprocessing_steps: Optional[Dict[str, Any]] = None,
        version_tag: Optional[str] = None,
        notes: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> str:
        """
        Save a trained model to disk and register in database.

        Returns the version_tag.
        """
        from datetime import datetime

        # Generate version tag if not provided
        if version_tag is None:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            version_tag = f"v{timestamp}"

        version_dir = os.path.join(self.models_dir, version_tag)
        os.makedirs(version_dir, exist_ok=True)

        # 1. Save model
        model_path = os.path.join(version_dir, "model.pkl")
        joblib.dump(model, model_path)

        # 2. Save feature list
        features_path = os.path.join(version_dir, "features.json")
        with open(features_path, 'w') as f:
            json.dump({
                "feature_names": feature_list,
                "preprocessing": preprocessing_steps or {}
            }, f, indent=2)

        # 3. Save metrics
        metrics_path = os.path.join(version_dir, "metrics.json")
        with open(metrics_path, 'w') as f:
            json.dump(performance_metrics, f, indent=2)

        # 4. Save params
        params_path = os.path.join(version_dir, "params.json")
        with open(params_path, 'w') as f:
            json.dump(model_params, f, indent=2)

        # 5. Register in database
        model_version = crud.create_model_version(
            self.db,
            schemas=type('obj', (object,), {
                'version_tag': version_tag,
                'model_type': model_type,
                'model_params': model_params,
                'training_data_range': training_data_range,
                'performance_metrics': performance_metrics,
                'feature_list': feature_list,
                'preprocessing_steps': preprocessing_steps,
                'notes': notes,
                'created_by': created_by or 'system',
            })
        )

        logger.info(f"Model version {version_tag} saved and registered successfully.")
        return version_tag

    def load_model(self, version_tag: str):
        """
        Load a model from disk by version tag.

        Returns:
            model: The trained model object
            feature_list: List of feature names
            metadata: Dict with model params, metrics, preprocessing steps
        """
        version_dir = os.path.join(self.models_dir, version_tag)
        model_path = os.path.join(version_dir, "model.pkl")
        catboost_model_path = os.path.join(version_dir, "model.cbm")
        features_path = os.path.join(version_dir, "features.json")
        metrics_path = os.path.join(version_dir, "metrics.json")
        params_path = os.path.join(version_dir, "params.json")

        # Check existence
        for p in [features_path, metrics_path, params_path]:
            if not os.path.exists(p):
                raise FileNotFoundError(f"Model artifact not found: {p}")

        if not os.path.exists(model_path) and not os.path.exists(catboost_model_path):
            raise FileNotFoundError(
                f"Model artifact not found: expected one of {model_path} or {catboost_model_path}"
            )

        # Load model artifact by format
        artifact_format = "joblib_pkl"
        if os.path.exists(model_path):
            model = joblib.load(model_path)
        else:
            try:
                from catboost import CatBoostRegressor
            except ImportError as e:
                raise ImportError(
                    "CatBoost model detected but catboost is not installed. "
                    "Install `catboost` in backend requirements."
                ) from e
            model = CatBoostRegressor()
            model.load_model(catboost_model_path)
            artifact_format = "catboost_cbm"

        with open(features_path, 'r') as f:
            features_data = json.load(f)
            feature_list = features_data.get('feature_names', [])
            preprocessing = features_data.get('preprocessing', {})

        with open(metrics_path, 'r') as f:
            metrics = json.load(f)

        with open(params_path, 'r') as f:
            params = json.load(f)

        metadata = {
            'feature_list': feature_list,
            'preprocessing': preprocessing,
            'metrics': metrics,
            'params': params,
            'artifact_format': artifact_format,
        }

        logger.info(f"Model {version_tag} loaded successfully.")
        return model, feature_list, metadata

    def get_latest_versions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get list of latest model versions.
        """
        versions = crud.get_model_versions(self.db, limit=limit)
        return [
            {
                "model_version_id": v.model_version_id,
                "version_tag": v.version_tag,
                "model_type": v.model_type,
                "training_date": v.training_date.isoformat() if v.training_date else None,
                "is_production": v.is_production,
                "performance_metrics": v.performance_metrics,
                "training_data_range": v.training_data_range,
                "feature_count": len(v.feature_list) if v.feature_list else 0,
            }
            for v in versions
        ]

    def get_production_model(self):
        """
        Get the current production model.

        Returns:
            model, feature_list, metadata, model_version_obj
        """
        mv = crud.get_production_model_version(self.db)
        if not mv:
            logger.warning("No production model found.")
            return None, None, None, None

        try:
            model, feature_list, metadata = self.load_model(mv.version_tag)
            return model, feature_list, metadata, mv
        except Exception as e:
            logger.error(f"Failed to load production model {mv.version_tag}: {e}")
            return None, None, None, None

    def delete_model_version(self, version_tag: str) -> bool:
        """
        Delete a model version from disk and database.
        """
        try:
            # Delete from DB
            mv = (
                self.db.query(crud.models.ModelVersion)
                .filter(crud.models.ModelVersion.version_tag == version_tag)
                .first()
            )
            if mv:
                self.db.delete(mv)
                self.db.commit()

            # Delete from disk
            version_dir = os.path.join(self.models_dir, version_tag)
            if os.path.exists(version_dir):
                import shutil
                shutil.rmtree(version_dir)

            logger.info(f"Model version {version_tag} deleted.")
            return True
        except Exception as e:
            logger.error(f"Failed to delete model version {version_tag}: {e}")
            return False

    def list_available_versions(self) -> List[str]:
        """
        List all version tags available on disk.
        """
        if not os.path.exists(self.models_dir):
            return []

        return [
            d for d in os.listdir(self.models_dir)
            if os.path.isdir(os.path.join(self.models_dir, d))
        ]

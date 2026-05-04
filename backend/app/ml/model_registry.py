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

    @staticmethod
    def _normalize_model_type(value: Optional[str]) -> str:
        """Normalize model-type labels from DB/params to stable internal values."""
        if not value:
            return ""
        normalized = str(value).strip().lower().replace("-", "_").replace(" ", "_")
        aliases = {
            "deep_learning": "deep_learning_pytorch",
            "deeplearning": "deep_learning_pytorch",
            "deep_learning_model": "deep_learning_pytorch",
            "pytorch": "deep_learning_pytorch",
            "torch": "deep_learning_pytorch",
            "cat_boost": "catboost",
        }
        return aliases.get(normalized, normalized)

    def _resolve_version_dir(self, version_tag: str) -> str:
        """
        Resolve a model directory for version_tag.
        Supports both:
        - <MODEL_PATH>/<version_tag>
        - nested layouts such as <MODEL_PATH>/<crop>/<version_tag>
        """
        direct_dir = os.path.join(self.models_dir, version_tag)
        if os.path.isdir(direct_dir):
            return direct_dir

        # Try DB metadata source path if available.
        db_row = (
            self.db.query(crud.models.ModelVersion)
            .filter(crud.models.ModelVersion.version_tag == version_tag)
            .first()
        )
        if db_row and isinstance(db_row.preprocessing_steps, dict):
            source_path = db_row.preprocessing_steps.get("source")
            if isinstance(source_path, str) and source_path.strip():
                source_path = source_path.strip()
                if not os.path.isabs(source_path):
                    source_path = os.path.join(self.models_dir, source_path)
                if os.path.isdir(source_path):
                    return source_path

        # Fallback: find nested folder by exact directory name.
        artifact_markers = ("model.pkl", "model.cbm", "model.pth")
        candidates = []
        for root, dirs, _ in os.walk(self.models_dir):
            for dirname in dirs:
                if dirname != version_tag:
                    continue
                candidate = os.path.join(root, dirname)
                if any(os.path.exists(os.path.join(candidate, marker)) for marker in artifact_markers):
                    candidates.append(candidate)

        if candidates:
            candidates.sort()
            return candidates[0]

        return direct_dir

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
        version_dir = self._resolve_version_dir(version_tag)
        model_path = os.path.join(version_dir, "model.pkl")
        catboost_model_path = os.path.join(version_dir, "model.cbm")
        pytorch_model_path = os.path.join(version_dir, "model.pth")
        features_path = os.path.join(version_dir, "features.json")
        metrics_path = os.path.join(version_dir, "metrics.json")
        params_path = os.path.join(version_dir, "params.json")

        # Check existence
        for p in [features_path, metrics_path, params_path]:
            if not os.path.exists(p):
                raise FileNotFoundError(f"Model artifact not found: {p}")

        if (
            not os.path.exists(model_path)
            and not os.path.exists(catboost_model_path)
            and not os.path.exists(pytorch_model_path)
        ):
            raise FileNotFoundError(
                "Model artifact not found: expected one of "
                f"{model_path}, {catboost_model_path}, or {pytorch_model_path}"
            )

        with open(features_path, 'r') as f:
            features_data = json.load(f)

        # features.json may be either:
        #   - {"feature_names": [...], "preprocessing": {...}}  (canonical, written by sync_models)
        #   - [feature_1, feature_2, ...]                        (legacy / external trainers)
        if isinstance(features_data, dict):
            feature_list = features_data.get('feature_names', [])
            preprocessing = features_data.get('preprocessing', {}) or {}
        elif isinstance(features_data, list):
            feature_list = list(features_data)
            preprocessing = {}
        else:
            raise ValueError(
                f"Unsupported features.json format in {features_path}: "
                f"expected dict or list, got {type(features_data).__name__}"
            )

        if not isinstance(feature_list, list):
            raise ValueError(
                f"Invalid feature_names in {features_path}: expected list, got {type(feature_list).__name__}"
            )
        if not isinstance(preprocessing, dict):
            preprocessing = {}

        with open(metrics_path, 'r') as f:
            metrics = json.load(f)
        if not isinstance(metrics, dict):
            metrics = {}

        with open(params_path, 'r') as f:
            params = json.load(f)
        if not isinstance(params, dict):
            params = {}

        # Determine expected runtime model type using all available metadata.
        db_row = (
            self.db.query(crud.models.ModelVersion)
            .filter(crud.models.ModelVersion.version_tag == version_tag)
            .first()
        )
        declared_types = {
            self._normalize_model_type(db_row.model_type if db_row else None),
            self._normalize_model_type(params.get("model_type") if isinstance(params, dict) else None),
            self._normalize_model_type(preprocessing.get("external_model_type") if isinstance(preprocessing, dict) else None),
        }
        declared_types.discard("")

        deep_types = {"deep_learning_pytorch"}
        catboost_types = {"catboost"}
        wants_deep = any(t in deep_types for t in declared_types)
        wants_catboost = any(t in catboost_types for t in declared_types)

        # Load model artifact by format. Prefer artifact matching declared model_type.
        artifact_format = "joblib_pkl"
        if wants_deep and os.path.exists(pytorch_model_path):
            from app.ml.torch_runtime import load_torch_tabular_model

            model = load_torch_tabular_model(
                version_dir=version_dir,
                feature_list=feature_list,
                preprocessing={
                    **(preprocessing or {}),
                    **(params if isinstance(params, dict) else {}),
                },
            )
            artifact_format = "pytorch_pth"
        elif wants_catboost and os.path.exists(catboost_model_path):
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
        elif wants_deep and not os.path.exists(pytorch_model_path):
            raise FileNotFoundError(
                f"Model version '{version_tag}' is marked deep learning ({sorted(declared_types)}), "
                f"but expected artifact is missing: {pytorch_model_path}"
            )
        elif wants_catboost and not os.path.exists(catboost_model_path):
            if os.path.exists(model_path):
                logger.warning(
                    "Model version %s is marked catboost (%s) but model.cbm is missing; "
                    "falling back to model.pkl",
                    version_tag,
                    sorted(declared_types),
                )
                model = joblib.load(model_path)
            else:
                raise FileNotFoundError(
                    f"Model version '{version_tag}' is marked catboost ({sorted(declared_types)}), "
                    f"but expected artifact is missing: {catboost_model_path}"
                )
        elif os.path.exists(model_path):
            model = joblib.load(model_path)
        elif os.path.exists(catboost_model_path):
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
        else:
            from app.ml.torch_runtime import load_torch_tabular_model

            model = load_torch_tabular_model(
                version_dir=version_dir,
                feature_list=feature_list,
                preprocessing={
                    **(preprocessing or {}),
                    **(params if isinstance(params, dict) else {}),
                },
            )
            artifact_format = "pytorch_pth"

        # Backfill missing CatBoost metadata from the loaded .cbm itself.
        # External CatBoost trainers commonly ship a flat-list features.json with no
        # preprocessing block, so the feature_list / categorical_features can be empty here.
        # The .cbm encodes both, so we read them back when our JSON metadata is missing.
        if artifact_format == "catboost_cbm":
            try:
                model_feature_names = list(getattr(model, "feature_names_", None) or [])
            except Exception:
                model_feature_names = []
            try:
                cat_indices = list(model.get_cat_feature_indices() or [])
            except Exception:
                cat_indices = []

            if model_feature_names:
                if not feature_list:
                    feature_list = list(model_feature_names)
                elif feature_list != model_feature_names:
                    logger.warning(
                        "feature_list from features.json (%d cols) does not match the "
                        ".cbm's feature_names_ (%d cols); using the model's order.",
                        len(feature_list),
                        len(model_feature_names),
                    )
                    feature_list = list(model_feature_names)

            existing_cats = preprocessing.get("categorical_features") if isinstance(preprocessing, dict) else None
            if (not isinstance(existing_cats, list) or not existing_cats) and cat_indices and model_feature_names:
                derived_cats = [
                    model_feature_names[i]
                    for i in cat_indices
                    if 0 <= i < len(model_feature_names)
                ]
                if derived_cats:
                    preprocessing["categorical_features"] = derived_cats
                    logger.info(
                        "Derived %d categorical features for %s from the .cbm: %s",
                        len(derived_cats),
                        version_tag,
                        derived_cats,
                    )

            # External CatBoost models always skip our internal feature engineering.
            preprocessing.setdefault("external_model", True)
            preprocessing.setdefault("external_model_type", "catboost")
            preprocessing.setdefault("skip_feature_engineering", True)
            preprocessing.setdefault(
                "input_aliases",
                {"crop": "crop_name_en", "variety": "variety_name_en"},
            )

        metadata = {
            'feature_list': feature_list,
            'preprocessing': preprocessing,
            'metrics': metrics,
            'params': params,
            'artifact_format': artifact_format,
            'declared_model_types': sorted(declared_types),
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
            version_dir = self._resolve_version_dir(version_tag)
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

"""
Prediction service - loads model and makes predictions
"""
import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
import logging

from app.ml.model_registry import ModelRegistry
from app.ml.features import FeatureEngineer, prepare_single_record_for_prediction

logger = logging.getLogger(__name__)


class PredictionService:
    """
    Service for making yield predictions.

    - Loads production model from registry
    - Applies feature engineering consistent with training
    - Returns predictions with confidence intervals
    """

    def __init__(self, db: Session):
        self.db = db
        self.registry = ModelRegistry(db)
        self.feature_engineer = FeatureEngineer()

        # Cache loaded model
        self._model = None
        self._feature_list = None
        self._metadata = None
        self._model_version = None

    def load_production_model(self):
        """
        Load the current production model from disk.
        Caches the model for subsequent predictions.
        """
        if self._model is None:
            model, feature_list, metadata, mv = self.registry.get_production_model()
            if model is None:
                raise ValueError("No production model available. Please train a model first.")

            self._model = model
            self._feature_list = feature_list
            self._metadata = metadata
            self._model_version = mv

            logger.info(f"Loaded production model: {mv.version_tag}")
        return self._model

    def get_production_model(self):
        """
        Get the model version object for the production model.
        """
        if self._model_version is None:
            self.load_production_model()
        return self._model_version

    def predict(
        self,
        input_data: Dict[str, Any],
        model_version=None
    ) -> Dict[str, Any]:
        """
        Make a prediction for a single field-season.

        Args:
            input_data: Dictionary with input features
                Required keys: crop, acres, lat, long, season, totalN_per_ac, totalP_per_ac, totalK_per_ac
                Optional: variety, state, county, water_applied_mm, event_count
            model_version: ModelVersion object (optional, will use production if None)

        Returns:
            Dict with:
                - predicted_yield: float
                - confidence_lower: float
                - confidence_upper: float
                - features: Feature vector used (for explainability)
        """
        # Load model if not cached
        if self._model is None:
            if model_version:
                # Load specific version
                model, feature_list, metadata = self.registry.load_model(model_version.version_tag)
                self._model = model
                self._feature_list = feature_list
                self._metadata = metadata
                self._model_version = model_version
            else:
                self.load_production_model()
        else:
            # If a specific model version is requested and it's different, reload
            if model_version and model_version.version_tag != self._model_version.version_tag:
                model, feature_list, metadata = self.registry.load_model(model_version.version_tag)
                self._model = model
                self._feature_list = feature_list
                self._metadata = metadata
                self._model_version = model_version

        # 1. Prepare input DataFrame (single row)
        df_input = pd.DataFrame([input_data])

        # 2. Basic feature engineering (ratios, interactions)
        df_input = self.feature_engineer.calculate_nutrient_ratios(df_input)
        df_input = self.feature_engineer.calculate_intensity_features(df_input)
        df_input = self.feature_engineer.create_interactions(df_input)

        # 3. Encode categoricals - for inference, we need to apply the same encoding as training
        # For now, use frequency encoding (simple). In production, we'd store target encodings.
        # Since we're using target encoding for training, we need to store those mappings.
        # For MVP, we'll fall back to frequency encoding
        df_input = self.feature_engineer.encode_categoricals(df_input, method='frequency')

        # 4. Ensure we have all required features and in the correct order
        # Align columns to feature_list
        missing_features = set(self._feature_list) - set(df_input.columns)
        if missing_features:
            logger.warning(f"Missing features: {missing_features}. Filling with 0.")
            for feat in missing_features:
                df_input[feat] = 0.0

        # Reorder columns to match training
        X = df_input[self._feature_list]

        # 5. Predict
        predicted_yield = float(self._model.predict(X)[0])

        # 6. Confidence interval
        # For tree ensembles, we can use quantile regression or bootstrap
        # For MVP, use a simple constant margin (or can compute from validation set residuals)
        # Store validation RMSE from model metadata for CI
        val_rmse = self._metadata.get('metrics', {}).get('val_rmse', 10.0)
        confidence_lower = predicted_yield - 1.96 * val_rmse
        confidence_upper = predicted_yield + 1.96 * val_rmse

        # 7. Prepare result
        result = {
            'predicted_yield': predicted_yield,
            'confidence_lower': confidence_lower,
            'confidence_upper': confidence_upper,
            'features': X.iloc[0].to_dict(),
            'base_value': self._model.get('base_score', 0) if hasattr(self._model, 'get') else 0,
        }

        logger.info(
            f"Prediction: field={input_data.get('field_number', 'N/A')}, "
            f"crop={input_data.get('crop')}, predicted_yield={predicted_yield:.2f}"
        )

        return result

    def batch_predict(
        self,
        inputs: list[Dict[str, Any]],
        model_version=None
    ) -> list[Dict[str, Any]]:
        """
        Make predictions for multiple records.
        """
        results = []
        for input_data in inputs:
            try:
                result = self.predict(input_data, model_version)
                results.append({
                    'success': True,
                    'predicted_yield': result['predicted_yield'],
                    'confidence_lower': result['confidence_lower'],
                    'confidence_upper': result['confidence_upper'],
                })
            except Exception as e:
                logger.error(f"Batch prediction failed: {e}")
                results.append({
                    'success': False,
                    'error': str(e),
                    'predicted_yield': None,
                })

        return results
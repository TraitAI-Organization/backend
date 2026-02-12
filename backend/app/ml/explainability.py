"""
Explainability engine - SHAP values and feature importance
"""
import numpy as np
import pandas as pd
import shap
from typing import Dict, List, Any
import logging

logger = logging.getLogger(__name__)


class ExplainabilityEngine:
    """
    Generate explanations for individual predictions using SHAP.

    For tree-based models (LightGBM, XGBoost, RandomForest), we use TreeExplainer.
    """

    def __init__(self, db, predictor):
        self.db = db
        self.predictor = predictor
        self._explainer = None

    def _get_explainer(self, model):
        """
        Get appropriate SHAP explainer for model type.
        """
        model_type = type(model).__name__

        if hasattr(model, 'predict_vals'):  # LightGBM
            return shap.TreeExplainer(model)
        elif hasattr(model, 'get_booster'):  # XGBoost
            return shap.TreeExplainer(model.get_booster())
        elif hasattr(model, 'estimators_'):  # RandomForest
            return shap.TreeExplainer(model)
        else:
            logger.warning(f"Unknown model type {model_type}, falling back to KernelExplainer")
            return shap.KernelExplainer(model.predict, shap.sample(self._background_data, 100))

    def explain_prediction(
        self,
        features: pd.DataFrame,
        model_version,
        base_value: float = None,
        top_n: int = 5
    ) -> Dict[str, Any]:
        """
        Generate SHAP explanation for a single prediction.

        Args:
            features: DataFrame with single row (feature vector)
            model_version: ModelVersion object or dict with model info
            base_value: Expected value (optional)
            top_n: Number of top features to return

        Returns:
            Dict with:
                - top_features: List of dicts with feature name, value, shap value, direction, importance
                - base_value: Expected value (mean prediction on background data)
        """
        # Load the model
        model, feature_list, metadata = self.predictor.registry.load_model(
            model_version.version_tag
        )

        # Prepare features in correct format
        if isinstance(features, dict):
            X = pd.DataFrame([features])
        else:
            X = features.copy()

        # Ensure all features are present
        missing = set(feature_list) - set(X.columns)
        if missing:
            for col in missing:
                X[col] = 0.0
        X = X[feature_list]

        # Create explainer (cache for performance)
        if self._explainer is None or self._current_model_tag != model_version.version_tag:
            self._explainer = self._get_explainer(model)
            self._current_model_tag = model_version.version_tag

        # Calculate SHAP values
        shap_values = self._explainer.shap_values(X)

        # For regression, shap_values is a single array (not a list of arrays like classification)
        if isinstance(shap_values, list):
            shap_values = shap_values[0]  # For models that return list

        # Get base value (expected value)
        base_value = self._explainer.expected_value
        if isinstance(base_value, np.ndarray):
            base_value = base_value[0]

        # Get feature contributions
        feature_contributions = []

        # shap_values shape: (1, n_features) for single prediction
        shap_vals = shap_values[0] if len(shap_values.shape) > 1 else shap_values

        for idx, (feature_name, shap_val) in enumerate(zip(feature_list, shap_vals)):
            feature_contributions.append({
                'feature': feature_name,
                'value': float(X.iloc[0, idx]),
                'shap_value': float(shap_val),
                'direction': 'positive' if shap_val > 0 else 'negative',
                'importance': float(abs(shap_val)),
            })

        # Sort by absolute SHAP value
        feature_contributions.sort(key=lambda x: x['importance'], reverse=True)

        # Normalize importance to 0-1 scale
        total_importance = sum(fc['importance'] for fc in feature_contributions)
        if total_importance > 0:
            for fc in feature_contributions:
                fc['importance'] = fc['importance'] / total_importance

        return {
            'base_value': float(base_value),
            'features': X.iloc[0].to_dict(),
            'predicted_value': float(base_value + shap_vals.sum()),
            'top_features': feature_contributions[:top_n],
            'all_contributions': feature_contributions,
        }

    def explain_batch(
        self,
        feature_vectors: List[pd.DataFrame],
        model_version
    ) -> List[Dict[str, Any]]:
        """
        Generate explanations for multiple predictions.
        """
        explanations = []
        for features in feature_vectors:
            explanation = self.explain_prediction(features, model_version)
            explanations.append(explanation)

        return explanations

    def get_global_feature_importance(
        self,
        model_version,
        background_data: pd.DataFrame,
        n_samples: int = 1000
    ) -> pd.DataFrame:
        """
        Compute global feature importance using SHAP on a sample of background data.

        Args:
            model_version: ModelVersion object
            background_data: DataFrame with background samples
            n_samples: Number of samples to use for SHAP computation

        Returns:
            DataFrame with features sorted by mean absolute SHAP value
        """
        model, feature_list, metadata = self.predictor.registry.load_model(
            model_version.version_tag
        )

        # Sample background data
        if len(background_data) > n_samples:
            background_data = background_data.sample(n_samples, random_state=42)

        # Ensure features match
        missing = set(feature_list) - set(background_data.columns)
        if missing:
            logger.warning(f"Background data missing features: {missing}. Filling with 0.")
            for col in missing:
                background_data[col] = 0.0

        X_bg = background_data[feature_list]

        # Compute SHAP values for background
        model_type = type(model).__name__
        if hasattr(model, 'predict_vals'):  # LightGBM
            explainer = shap.TreeExplainer(model)
        elif hasattr(model, 'get_booster'):  # XGBoost
            explainer = shap.TreeExplainer(model.get_booster())
        elif hasattr(model, 'estimators_'):  # RandomForest
            explainer = shap.TreeExplainer(model)
        else:
            logger.warning("Unsupported model for SHAP TreeExplainer")
            return pd.DataFrame()

        shap_values = explainer.shap_values(X_bg)
        if isinstance(shap_values, list):
            shap_values = shap_values[0]

        # Compute mean absolute SHAP value for each feature
        mean_abs_shap = np.mean(np.abs(shap_values), axis=0)

        importance_df = pd.DataFrame({
            'feature': feature_list,
            'mean_abs_shap': mean_abs_shap,
        }).sort_values('mean_abs_shap', ascending=False)

        return importance_df
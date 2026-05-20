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
        self._current_model_tag = None
        self._background_data = None
        # When the active model is a multi-output CatBoost (MultiQuantile),
        # SHAP returns attributions for every output column. We explain the
        # MEDIAN quantile because that's what gets displayed as the point
        # estimate in the UI. None = single-output model, no slice needed.
        self._median_output_idx: int | None = None

    def _get_explainer(self, model, _is_recursive: bool = False):
        """
        Get appropriate SHAP explainer for model type.

        `_is_recursive` is set internally when the function unwraps a
        wrapper and re-enters itself on the underlying model. It tells the
        inner call to PRESERVE the multi-output state the outer call just
        established (so the SHAP-value post-processing knows which column
        to slice out of a multi-output attribution tensor).
        """
        # Top-level entry: clear any multi-output state from a previous
        # explain. The recursive branches preserve whatever they set up.
        if not _is_recursive:
            self._median_output_idx = None

        # Unwrap our own quantile-ensemble wrapper (CatBoostQuantileWrapper)
        # before dispatching. SHAP's TreeExplainer doesn't recognize the
        # wrapper class — its __module__ is app.ml.model_registry, which
        # matches none of the checks below — so we explain via the
        # underlying median estimator, which IS a real CatBoost model.
        if hasattr(model, "models_by_quantile"):
            underlying = getattr(model, "_median", None)
            if underlying is None and isinstance(model.models_by_quantile, dict) and model.models_by_quantile:
                underlying = next(iter(model.models_by_quantile.values()))
            if underlying is not None:
                return self._get_explainer(underlying, _is_recursive=True)

        # Same idea for the single-binary MultiQuantile wrapper
        # (CatBoostMultiQuantileWrapper): its underlying `_model` IS a real
        # CatBoost instance with multi-output predictions. TreeExplainer
        # handles multi-output CatBoost natively, returning SHAP values for
        # each quantile column. Without this unwrap we fall through to
        # KernelExplainer, which produces all-zero attributions on the
        # 86-feature schema (no background data is wired in for fallback).
        if hasattr(model, "trained_quantiles") and hasattr(model, "_model"):
            underlying = getattr(model, "_model", None)
            if underlying is not None:
                # Remember which output column corresponds to the median
                # quantile so the SHAP-value processing can slice the
                # right one out of the multi-output attribution tensor.
                self._median_output_idx = getattr(model, "_median_idx", None)
                return self._get_explainer(underlying, _is_recursive=True)
        # (No unconditional reset here — the top-level call already cleared
        # _median_output_idx if needed.)

        model_type = type(model).__name__
        model_module = (type(model).__module__ or "")

        # LightGBM: LGBMRegressor / LGBMClassifier / Booster — TreeExplainer takes them directly.
        if model_module.startswith("lightgbm") or hasattr(model, "booster_"):
            return shap.TreeExplainer(model)
        # XGBoost: pass the underlying Booster for best compatibility.
        if model_module.startswith("xgboost") or hasattr(model, "get_booster"):
            return shap.TreeExplainer(model.get_booster()) if hasattr(model, "get_booster") else shap.TreeExplainer(model)
        # CatBoost
        if model_module.startswith("catboost"):
            return shap.TreeExplainer(model)
        # sklearn tree ensembles (RandomForest, GradientBoosting, ExtraTrees, etc.)
        if hasattr(model, "estimators_"):
            return shap.TreeExplainer(model)

        logger.warning(f"Unknown model type {model_type} (module={model_module}), falling back to KernelExplainer")
        if self._background_data is None or len(self._background_data) == 0:
            raise ValueError("No background data available for KernelExplainer fallback")
        return shap.KernelExplainer(model.predict, shap.sample(self._background_data, min(len(self._background_data), 100)))

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
        self._background_data = X.copy()

        # Create explainer (cache for performance)
        if self._explainer is None or self._current_model_tag != model_version.version_tag:
            self._explainer = self._get_explainer(model)
            self._current_model_tag = model_version.version_tag

        # CatBoost requires categorical features to be int or string when
        # building a Pool. The values reaching us here have been round-tripped
        # through `X.iloc[0].to_dict()` → `pd.DataFrame([dict])`, which loses
        # the int64 dtype that the predictor's preprocessing set. SHAP's
        # CatBoost path internally calls `catboost.Pool(X, cat_features=...)`,
        # which then errors with "cat_features must be integer or string".
        # Coerce those columns back before SHAP touches them.
        # For SHAP-friendly categorical-index lookup, drill through both
        # wrapper flavors to a real CatBoost. QuantileWrapper exposes
        # `_median`; MultiQuantileWrapper exposes `_model`. Both have
        # the genuine `get_cat_feature_indices()` we want.
        underlying_model = (
            getattr(model, "_median", None)
            or getattr(model, "_model", None)
            or model
        )
        cat_indices: List[int] = []
        get_cat_indices = getattr(underlying_model, "get_cat_feature_indices", None)
        if callable(get_cat_indices):
            try:
                cat_indices = list(get_cat_indices() or [])
            except Exception:
                cat_indices = []
        for idx in cat_indices:
            if idx < 0 or idx >= len(feature_list):
                continue
            col = feature_list[idx]
            series = X[col]
            # Already int-like? Cast to int64 so Pool accepts it. Otherwise
            # fall back to string (also valid for cat_features).
            try:
                X[col] = series.astype("int64")
            except (ValueError, TypeError):
                X[col] = series.astype(str)

        # Calculate SHAP values
        shap_values = self._explainer.shap_values(X)

        # Multi-output CatBoost (MultiQuantile, p10/p50/p90) returns SHAP
        # values shaped per output. Use the median-output index recorded
        # during _get_explainer so we surface the attributions tied to
        # the point estimate the UI actually displays. Fall back to index
        # 0 for legacy single-output models (matches prior behavior).
        median_idx = self._median_output_idx
        if isinstance(shap_values, list):
            if median_idx is not None and 0 <= median_idx < len(shap_values):
                shap_values = shap_values[median_idx]
            else:
                shap_values = shap_values[0]
        elif hasattr(shap_values, "ndim") and shap_values.ndim == 3:
            # Some SHAP versions return a (n_samples, n_features, n_outputs)
            # tensor for multi-output trees. Slice the median output.
            if median_idx is not None and 0 <= median_idx < shap_values.shape[-1]:
                shap_values = shap_values[..., median_idx]
            else:
                shap_values = shap_values[..., 0]

        # Get base value (expected value). For multi-output CatBoost (the
        # MultiQuantile model), SHAP returns expected_value as a PYTHON LIST
        # of length n_outputs ([ev_p10, ev_p50, ev_p90]) — not a numpy array
        # — so the isinstance(ndarray) branch alone misses it and `float(list)`
        # later blows up. Handle both shapes here.
        base_value = self._explainer.expected_value
        if isinstance(base_value, (list, tuple)):
            if median_idx is not None and 0 <= median_idx < len(base_value):
                base_value = base_value[median_idx]
            elif len(base_value) > 0:
                base_value = base_value[0]
            else:
                base_value = 0.0
        elif isinstance(base_value, np.ndarray):
            if base_value.ndim == 0:
                # Scalar wrapped in 0-d array — pull out the value.
                base_value = base_value.item()
            elif median_idx is not None and 0 <= median_idx < base_value.shape[0]:
                base_value = base_value[median_idx]
            else:
                base_value = base_value[0]

        # Get feature contributions
        feature_contributions = []

        # shap_values shape: (1, n_features) for single prediction
        shap_vals = shap_values[0] if len(shap_values.shape) > 1 else shap_values

        for idx, (feature_name, shap_val) in enumerate(zip(feature_list, shap_vals)):
            raw_value = X.iloc[0, idx]
            if isinstance(raw_value, np.generic):
                raw_value = raw_value.item()
            if isinstance(raw_value, float) and np.isnan(raw_value):
                raw_value = None
            feature_contributions.append({
                'feature': feature_name,
                'value': raw_value,
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

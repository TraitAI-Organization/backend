"""
Prediction service - loads model and makes predictions
"""
import os
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
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
        preprocessing = self._metadata.get('preprocessing', {}) if self._metadata else {}

        # Add common aliases for externally provided model features.
        aliases = {
            "crop": "crop_name_en",
            "variety": "variety_name_en",
        }
        aliases.update(preprocessing.get("input_aliases", {}))
        for src, dst in aliases.items():
            if src in df_input.columns and dst not in df_input.columns:
                df_input[dst] = df_input[src]

        # 2. Basic feature engineering (skip for external models with pre-defined feature schema)
        skip_engineering = preprocessing.get("skip_feature_engineering", False) or preprocessing.get("external_model", False)
        if not skip_engineering:
            df_input = self.feature_engineer.calculate_nutrient_ratios(df_input)
            df_input = self.feature_engineer.calculate_intensity_features(df_input)
            df_input = self.feature_engineer.create_interactions(df_input)

            # 3. Encode categoricals - for inference, we need to apply the same encoding as training
            # For now, use frequency encoding (simple). In production, we'd store target encodings.
            df_input = self.feature_engineer.encode_categoricals(df_input, method='frequency')

        # 4. Ensure we have all required features and in the correct order
        # Align columns to feature_list
        categorical_features = set(preprocessing.get("categorical_features", []))
        missing_features = set(self._feature_list) - set(df_input.columns)
        if missing_features:
            logger.warning(f"Missing features: {missing_features}. Filling with defaults.")
            for feat in missing_features:
                if feat in categorical_features:
                    df_input[feat] = "Missing"
                else:
                    df_input[feat] = 0.0

        # Reorder columns to match training
        X = df_input[self._feature_list].copy()
        for col in self._feature_list:
            if col in categorical_features:
                X[col] = X[col].fillna("Missing").astype(str)
            else:
                X[col] = pd.to_numeric(X[col], errors="coerce").fillna(0.0)

        # Apply trainer-provided categorical mappings if available. Both CatBoost and
        # PyTorch were trained on integer-encoded categoricals, so feeding raw strings
        # at inference produces unknown-token behavior (worst case: every row becomes
        # an out-of-vocab default). cat_mappings.json carries the exact string->int
        # encoding used during training; "Missing" is reserved as the OOV bucket.
        cat_mappings = self._metadata.get('cat_mappings') if self._metadata else None
        if cat_mappings:
            for col in self._feature_list:
                if col not in categorical_features or col not in cat_mappings:
                    continue
                mapping = cat_mappings[col]
                missing_code = mapping.get("Missing", 0)
                X[col] = X[col].map(lambda v: mapping.get(v, missing_code)).astype('int64')

        # Apply numeric feature scaling. The engineer's training script ran
        # `StandardScaler.fit_transform` on every numeric column before training,
        # so the model's learned decision boundaries / network weights operate
        # in the standardized space. Without applying the same transform here,
        # raw inputs land in a completely different region of the feature
        # space and predictions collapse toward a narrow band.
        #
        # IMPORTANT: skip this step for models whose wrapper already scales
        # inputs internally. TorchTabularModelWrapper applies the scaler inside
        # _prepare_inputs() before the forward pass; if we ALSO scale here, the
        # DL model receives doubly-standardized inputs and its output blows up
        # (we observed predictions > 10,000 bu/ac with merged inputs that work
        # correctly for CatBoost). CatBoost has no such internal scaler, so it
        # still needs the transform applied here.
        wrapper_handles_scaling = self._model.__class__.__name__ == "TorchTabularModelWrapper"
        numeric_scaler = self._metadata.get('numeric_scaler') if self._metadata else None
        if numeric_scaler is not None and not wrapper_handles_scaling:
            scaler_cols = getattr(numeric_scaler, "feature_names_in_", None)
            if scaler_cols is not None:
                # Only transform columns the scaler was fitted on AND that are
                # in our current X. This is robust against schema drift between
                # training and the active feature list.
                cols_to_scale = [c for c in scaler_cols if c in X.columns]
                if cols_to_scale:
                    try:
                        # Build a sub-DataFrame in the EXACT column order the
                        # scaler expects; sklearn's StandardScaler.transform
                        # is positional, not name-based.
                        scaler_input = X[list(scaler_cols)].copy()
                        # Defensive: anything that's not in X but the scaler
                        # expected gets 0 (matches training-time fillna(0)).
                        for c in scaler_cols:
                            if c not in X.columns:
                                scaler_input[c] = 0.0
                        scaled = numeric_scaler.transform(scaler_input)
                        # Write scaled values back to X for the columns the
                        # scaler covered.
                        for i, c in enumerate(scaler_cols):
                            if c in X.columns:
                                X[c] = scaled[:, i]
                    except Exception as e:
                        logger.warning(
                            "numeric_scaler.transform failed; falling back to raw "
                            "values (predictions will likely collapse): %s", e
                        )

        # 5. Predict (point estimate + optional input-dependent uncertainty)
        predicted_yield = float(self._model.predict(X)[0])

        # Try to obtain input-dependent prediction bounds from the model itself.
        # Two supported sources:
        #   - CatBoost quantile ensembles expose .predict_quantiles(X) -> {q: array}
        #   - Deep-learning uncertainty heads expose .predict_with_uncertainty(X) -> (mean, log_var)
        raw_lower: Optional[float] = None
        raw_upper: Optional[float] = None
        raw_median: Optional[float] = None
        raw_sigma: Optional[float] = None  # standardized space sigma (DL only)
        # Fraction of the predictive distribution covered by [lower, upper].
        # Carried through so the frontend can label intervals honestly (a
        # CatBoost ensemble trained on q=0.05/q=0.95 gives a 90% interval,
        # NOT 95% — labeling everything "95%" is misleading). Default 0.95
        # matches the legacy RMSE fallback's 1.96·sigma margin.
        confidence_level: Optional[float] = None

        if hasattr(self._model, "predict_quantiles"):
            try:
                qpreds = self._model.predict_quantiles(X)
                if qpreds:
                    qkeys = sorted(qpreds.keys())
                    # Lower = smallest quantile, upper = largest, median = closest to 0.5.
                    low_pred = float(qpreds[qkeys[0]][0])
                    high_pred = float(qpreds[qkeys[-1]][0])
                    # Tree-based quantile models don't guarantee monotonicity across
                    # quantiles per input, so enforce it here.
                    raw_lower = min(low_pred, high_pred)
                    raw_upper = max(low_pred, high_pred)
                    median_q = min(qkeys, key=lambda q: abs(q - 0.5))
                    raw_median = float(qpreds[median_q][0])
                    # e.g. q ∈ {0.05, 0.5, 0.95} → coverage = 0.90.
                    confidence_level = float(qkeys[-1] - qkeys[0])
            except Exception as e:
                logger.warning(f"predict_quantiles failed; falling back to RMSE bounds: {e}")
        elif hasattr(self._model, "predict_with_uncertainty"):
            try:
                uq = self._model.predict_with_uncertainty(X)
                if uq is not None:
                    mean_arr, var_arr = uq
                    mean_val = float(mean_arr[0])
                    raw_second = float(var_arr[0])
                    # The interpretation of the network's second output depends on how the
                    # model was trained. Configurable via params.json or features.preprocessing:
                    #   "uncertainty_output": "log_variance" | "variance" | "std"
                    # Default is "log_variance" (matches Gaussian NLL with log-var head).
                    params = self._metadata.get("params", {}) if self._metadata else {}
                    # Priority: wrapper attribute (set by torch_runtime based on architecture)
                    # > params.json > preprocessing > legacy default.
                    uncertainty_kind = (
                        getattr(self._model, "uncertainty_output", None)
                        or params.get("uncertainty_output")
                        or preprocessing.get("uncertainty_output")
                        or "log_variance"
                    )
                    if uncertainty_kind == "log_variance":
                        # Clamp to avoid overflow on extreme log-variance values.
                        clamped = max(min(raw_second, 20.0), -20.0)
                        sigma = float(np.sqrt(np.exp(clamped)))
                    elif uncertainty_kind == "variance":
                        sigma = float(np.sqrt(max(raw_second, 0.0)))
                    elif uncertainty_kind == "std":
                        sigma = float(abs(raw_second))
                    else:
                        logger.warning(
                            f"Unknown uncertainty_output '{uncertainty_kind}'; falling back to log_variance."
                        )
                        clamped = max(min(raw_second, 20.0), -20.0)
                        sigma = float(np.sqrt(np.exp(clamped)))

                    raw_median = mean_val
                    raw_sigma = sigma
                    raw_lower = mean_val - 1.96 * sigma
                    raw_upper = mean_val + 1.96 * sigma
                    # mean ± 1.96·σ covers ~95% of a Gaussian.
                    confidence_level = 0.95
            except Exception as e:
                logger.warning(f"predict_with_uncertainty failed; falling back to RMSE bounds: {e}")

        if raw_median is not None:
            predicted_yield = raw_median

        # Global target scaler back-transform (applies to models trained with
        # target standardization, e.g. the deep-learning model that ships
        # target_scaler.json: {"mean": ..., "std": ...}).
        target_scaler = self._metadata.get("target_scaler") if self._metadata else None
        if isinstance(target_scaler, dict):
            try:
                ts_mean = float(target_scaler.get("mean", 0.0))
                ts_std = float(target_scaler.get("std", 1.0)) or 1.0
                predicted_yield = predicted_yield * ts_std + ts_mean
                if raw_lower is not None:
                    raw_lower = raw_lower * ts_std + ts_mean
                if raw_upper is not None:
                    raw_upper = raw_upper * ts_std + ts_mean
                if raw_sigma is not None:
                    raw_sigma = raw_sigma * ts_std
            except Exception as e:
                logger.warning(f"Failed to apply target_scaler back-transform: {e}")

        # Optional back-transform for externally standardized targets.
        # Apply the same affine transform to bounds (linearity preserves ordering),
        # and scale sigma by std_crop for DL uncertainty.
        std_crop_applied = 1.0
        mean_crop_applied = 0.0
        if preprocessing.get("target_standardization") == "crop_zscore":
            crop_col = preprocessing.get("crop_column", "crop_name_en")
            crop_stats_file = preprocessing.get("crop_statistics_file")
            crop_value = None
            if crop_col in X.columns:
                crop_value = str(X[crop_col].iloc[0])
            elif "crop" in input_data:
                crop_value = str(input_data["crop"])

            if crop_stats_file and crop_value and self._model_version is not None:
                stats_path = os.path.join(
                    self.registry.models_dir,
                    self._model_version.version_tag,
                    crop_stats_file,
                )
                if os.path.exists(stats_path):
                    try:
                        crop_stats = pd.read_csv(stats_path)
                        match = crop_stats[crop_stats["crop_name_en"] == crop_value]
                        if not match.empty:
                            mean_crop = float(match.iloc[0]["yield_mean_crop"])
                            std_crop = float(match.iloc[0]["yield_std_crop"])
                            std_crop = std_crop if std_crop != 0 else 1.0
                            std_crop_applied = std_crop
                            mean_crop_applied = mean_crop
                            predicted_yield = predicted_yield * std_crop + mean_crop
                            if raw_lower is not None:
                                raw_lower = raw_lower * std_crop + mean_crop
                            if raw_upper is not None:
                                raw_upper = raw_upper * std_crop + mean_crop
                            if raw_sigma is not None:
                                raw_sigma = raw_sigma * std_crop
                    except Exception as e:
                        logger.warning(f"Failed to apply crop z-score back-transform: {e}")

        # 6. Confidence interval — prefer model-derived bounds; fall back to legacy RMSE margin.
        if raw_lower is not None and raw_upper is not None:
            confidence_lower = raw_lower
            confidence_upper = raw_upper
        else:
            val_rmse = self._metadata.get('metrics', {}).get('val_rmse', 10.0)
            confidence_lower = predicted_yield - 1.96 * val_rmse
            confidence_upper = predicted_yield + 1.96 * val_rmse
            # 1.96·val_rmse is the 95% Gaussian prediction interval.
            confidence_level = 0.95

        # Defensive clamp: the predictions table stores yields/bounds as NUMERIC(6, 2),
        # so values must fit in ±9999.99. A miscalibrated variance head can otherwise
        # produce values that abort the entire batch commit. We log loudly so the
        # condition is visible rather than silently masking a real model issue.
        bound_limit = 9999.99
        if (
            abs(confidence_lower) > bound_limit
            or abs(confidence_upper) > bound_limit
            or abs(predicted_yield) > bound_limit
        ):
            logger.warning(
                "Clamping out-of-range prediction for model %s: "
                "yield=%.3f, lower=%.3f, upper=%.3f (limit=±%.2f). "
                "Likely a miscalibrated uncertainty head — check 'uncertainty_output' "
                "interpretation in params.json/features.preprocessing.",
                getattr(self._model_version, "version_tag", "?"),
                predicted_yield,
                confidence_lower,
                confidence_upper,
                bound_limit,
            )
            predicted_yield = max(min(predicted_yield, bound_limit), -bound_limit)
            confidence_lower = max(min(confidence_lower, bound_limit), -bound_limit)
            confidence_upper = max(min(confidence_upper, bound_limit), -bound_limit)

        # 7. Prepare result
        result = {
            'predicted_yield': predicted_yield,
            'confidence_lower': confidence_lower,
            'confidence_upper': confidence_upper,
            'confidence_level': confidence_level,
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

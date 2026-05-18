"""
Prediction endpoints - ML model inference
"""
import json
import math
import os
from functools import lru_cache
from typing import Dict, Any, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
import logging

from app.database.session import get_db
from app.database import crud, models as db_models
from app.database.schemas import (
    PredictionRequest,
    PredictionResponse,
    FeatureContribution,
    MultiModelPredictionResponse,
    MultiModelPredictionItem,
    PredictionRunResponse,
)
from app.ml.predictor import PredictionService
from app.ml.explainability import ExplainabilityEngine
from app.services.regional_stats import RegionalStatsService

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# County-centroid lookup for lat/long enrichment
# ---------------------------------------------------------------------------
# `long` (importance 11.10) and `lat` (6.22) are the 2nd- and 4th-most
# important features in the live GenMills CatBoost model — between them
# they're roughly 17 importance points the model can use when both are
# present. The prediction wizard intentionally doesn't ask users for
# coordinates (most growers don't know their field's lat/long), so the
# request payload arrives with state + county but no coords. This lookup
# fills them in from a (state, county) -> centroid table derived from the
# training data, restoring the model's geographic signal.
#
# The enrichment is reported back in the response (`coordinates_source`)
# so the frontend can tell the user we used their county's centroid
# rather than asking them to provide coordinates manually.

_CENTROIDS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "data",
    "state_county_centroids.json",
)


@lru_cache(maxsize=1)
def _load_centroids() -> Dict[str, Dict[str, Dict[str, float]]]:
    """Load the state -> county -> {lat, long, training_rows} table.

    Cached for the process lifetime — the file is static, regenerated only
    when we retrain or import a new model.
    """
    try:
        with open(_CENTROIDS_PATH, "r") as fh:
            return json.load(fh)
    except FileNotFoundError:
        logger.warning(
            "Centroid lookup file not found at %s; lat/long will not be auto-filled",
            _CENTROIDS_PATH,
        )
        return {}
    except Exception as exc:
        logger.warning("Failed to load centroid lookup: %s", exc)
        return {}


def _resolve_centroid(state: Optional[str], county: Optional[str]) -> Optional[Tuple[float, float]]:
    """Return (lat, long) for a (state, county) pair, or None if not covered.

    The centroid table is derived from the model's training data, so any
    (state, county) that the model was actually trained on will resolve.
    Unsupported regions return None and the predict path will pass NaN
    coords to the model (same behavior as before this enrichment landed).
    """
    if not state or not county:
        return None
    centroids = _load_centroids()
    state_block = centroids.get(state)
    if not state_block:
        return None
    point = state_block.get(county)
    if not point:
        return None
    lat = point.get("lat")
    lng = point.get("long")
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _serialize_prediction_run(run: db_models.PredictionRun) -> Dict[str, Any]:
    return {
        "prediction_run_id": run.prediction_run_id,
        "model_version_id": run.model_version_id,
        "model_version_tag": run.model_version_tag,
        "crop": run.crop,
        "variety": run.variety,
        "season": run.season,
        "state": run.state,
        "county": run.county,
        "acres": _to_float(run.acres),
        "lat": _to_float(run.lat),
        "long": _to_float(run.long),
        "totalN_per_ac": _to_float(run.totalN_per_ac),
        "totalP_per_ac": _to_float(run.totalP_per_ac),
        "totalK_per_ac": _to_float(run.totalK_per_ac),
        "water_applied_mm": _to_float(run.water_applied_mm),
        "event_count": run.event_count,
        "predicted_yield": _to_float(run.predicted_yield) or 0.0,
        "confidence_lower": _to_float(run.confidence_lower),
        "confidence_upper": _to_float(run.confidence_upper),
        "regional_comparison": run.regional_comparison,
        "feature_contributions": run.feature_contributions or [],
        "request_payload": run.request_payload or {},
        "response_payload": run.response_payload or {},
        "created_at": run.created_at,
    }


@router.post("", response_model=PredictionResponse, summary="Predict yield")
async def predict_yield(
    request: PredictionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Predict crop yield based on input features.

    **Input Features:**
    - crop: Crop type (e.g., "Sorghum", "Wheat, Hard Winter")
    - variety: Optional variety name
    - acres: Field size in acres
    - lat, long: Field coordinates (WGS84)
    - season: Optional year (e.g., 2025)
    - totalN_per_ac: Total nitrogen applied (lb/ac)
    - totalP_per_ac: Total phosphorus applied (lb/ac)
    - totalK_per_ac: Total potassium applied (lb/ac)

    **Optional Features:**
    - water_applied_mm: Irrigation water applied
    - event_count: Number of management events
    - county: County name (for regional comparison)
    - state: State name (for regional comparison)

    **Returns:**
    - predicted_yield: Predicted yield in bu/ac
    - confidence_interval: [lower, upper] bounds
    - model_version: Version of model used
    - regional_comparison: How prediction compares to regional average
    - explainability: Top 5 contributing features with SHAP values
    """
    try:
        # Initialize prediction service
        predictor = PredictionService(db)

        # Get production model
        model_version = predictor.get_production_model()
        if not model_version:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No production model available. Please train a model first."
            )

        # Check if we have regional data for comparison
        county = request.county if hasattr(request, 'county') and request.county else None
        state = request.state if hasattr(request, 'state') and request.state else None

        # If county/state not provided, try to infer from lat/long
        if not county or not state or request.season is None:
            # Could use reverse geocoding here (future enhancement)
            regional_comparison = None
        else:
            regional_stats = RegionalStatsService(db)
            regional_avg = regional_stats.get_county_avg(
                crop=request.crop,
                season=request.season,
                state=state,
                county=county
            )
            regional_comparison = regional_avg

        # Enrich the request payload with a county-centroid lat/long when
        # the user didn't supply coordinates. `long` and `lat` are the
        # 2nd/4th most important features in the live model, so feeding
        # the model NaN for both (the previous behavior) was costing us
        # noticeable accuracy. We record what we did via
        # `coordinates_source` so the response can be transparent about
        # whether the prediction used user-provided or county-centroid
        # coordinates.
        request_features = request.model_dump(exclude_none=True)
        user_lat = request_features.get("lat")
        user_long = request_features.get("long")
        coordinates_source = "user_provided" if (user_lat is not None and user_long is not None) else None
        if coordinates_source is None:
            centroid = _resolve_centroid(state, county)
            if centroid is not None:
                centroid_lat, centroid_long = centroid
                if user_lat is None:
                    request_features["lat"] = centroid_lat
                if user_long is None:
                    request_features["long"] = centroid_long
                coordinates_source = "county_centroid"
            else:
                coordinates_source = "unavailable"

        # Generate prediction
        prediction_result = predictor.predict(request_features, model_version)

        # Get explainability (best-effort; do not fail prediction if explanation fails)
        explanations = {"top_features": []}
        try:
            explainer = ExplainabilityEngine(db, predictor)
            explanations = explainer.explain_prediction(
                features=prediction_result['features'],
                model_version=model_version,
                base_value=prediction_result.get('base_value', 0.0)
            )
        except Exception as explain_err:
            logger.warning(
                f"Explainability unavailable for model {model_version.version_tag}: {explain_err}",
                exc_info=True,
            )

        # Build response
        response = PredictionResponse(
            predicted_yield=prediction_result['predicted_yield'],
            confidence_interval=[
                prediction_result['confidence_lower'],
                prediction_result['confidence_upper']
            ],
            confidence_level=prediction_result.get('confidence_level'),
            model_version=model_version.version_tag,
            regional_comparison=regional_comparison,
            explainability={
                "top_features": [
                    FeatureContribution(
                        feature=feat['feature'],
                        value=feat['value'],
                        direction=feat['direction'],
                        importance=feat['importance']
                    ).model_dump()
                    for feat in explanations['top_features'][:5]
                ]
            },
            recommendations=None,  # Future: fertilizer recommendations
            coordinates_source=coordinates_source,
        )

        request_payload = request.model_dump(mode="json", exclude_none=True)
        response_payload = response.model_dump(mode="json")
        top_features = (response_payload.get("explainability") or {}).get("top_features", [])

        db_run = crud.create_prediction_run(
            db,
            request_payload=request_payload,
            response_payload=response_payload,
            model_version=model_version,
            regional_comparison=regional_comparison,
            feature_contributions=top_features,
        )
        response.prediction_run_id = db_run.prediction_run_id

        # Optionally log prediction for future analysis (background task)
        background_tasks.add_task(
            log_prediction_request,
            request=request,
            response=response,
            model_version=model_version.version_tag
        )

        return response

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction failed: {str(e)}"
        )


@router.post("/model/{version_tag}", response_model=PredictionResponse, summary="Predict yield with a specific model version")
async def predict_yield_specific_model(
    version_tag: str,
    request: PredictionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Predict crop yield using a specific model version tag.
    """
    try:
        model_version = (
            db.query(db_models.ModelVersion)
            .filter(db_models.ModelVersion.version_tag == version_tag)
            .first()
        )
        if not model_version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Model version '{version_tag}' not found."
            )

        predictor = PredictionService(db)

        county = request.county if hasattr(request, 'county') and request.county else None
        state = request.state if hasattr(request, 'state') and request.state else None
        if not county or not state or request.season is None:
            regional_comparison = None
        else:
            regional_stats = RegionalStatsService(db)
            regional_comparison = regional_stats.get_county_avg(
                crop=request.crop,
                season=request.season,
                state=state,
                county=county
            )

        prediction_result = predictor.predict(request.model_dump(exclude_none=True), model_version=model_version)

        explanations = {"top_features": []}
        try:
            explainer = ExplainabilityEngine(db, predictor)
            explanations = explainer.explain_prediction(
                features=prediction_result['features'],
                model_version=model_version,
                base_value=prediction_result.get('base_value', 0.0)
            )
        except Exception as explain_err:
            logger.warning(
                f"Explainability unavailable for model {model_version.version_tag}: {explain_err}",
                exc_info=True,
            )

        response = PredictionResponse(
            predicted_yield=prediction_result['predicted_yield'],
            confidence_interval=[
                prediction_result['confidence_lower'],
                prediction_result['confidence_upper']
            ],
            confidence_level=prediction_result.get('confidence_level'),
            model_version=model_version.version_tag,
            regional_comparison=regional_comparison,
            explainability={
                "top_features": [
                    FeatureContribution(
                        feature=feat['feature'],
                        value=feat['value'],
                        direction=feat['direction'],
                        importance=feat['importance']
                    ).model_dump()
                    for feat in explanations['top_features'][:5]
                ]
            },
            recommendations=None,
        )

        request_payload = request.model_dump(mode="json", exclude_none=True)
        response_payload = response.model_dump(mode="json")
        top_features = (response_payload.get("explainability") or {}).get("top_features", [])

        db_run = crud.create_prediction_run(
            db,
            request_payload=request_payload,
            response_payload=response_payload,
            model_version=model_version,
            regional_comparison=regional_comparison,
            feature_contributions=top_features,
        )
        response.prediction_run_id = db_run.prediction_run_id

        background_tasks.add_task(
            log_prediction_request,
            request=request,
            response=response,
            model_version=model_version.version_tag
        )

        return response

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Prediction error for specific model {version_tag}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction failed: {str(e)}"
        )


@router.post("/all-models", response_model=MultiModelPredictionResponse, summary="Predict yield across all registered models")
async def predict_yield_all_models(
    request: PredictionRequest,
    db: Session = Depends(get_db),
):
    """
    Predict yield using every registered model version.

    Useful for model comparison in external frontends.
    Returns one entry per model with either prediction values or an error.
    """
    try:
        predictor = PredictionService(db)
        model_versions = crud.get_model_versions(db, limit=500)
        if not model_versions:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No model versions available. Register/train a model first."
            )

        payload = request.model_dump(exclude_none=True)
        items: List[MultiModelPredictionItem] = []
        explainer = ExplainabilityEngine(db, predictor)
        for mv in model_versions:
            try:
                result = predictor.predict(payload, model_version=mv)
                explanations = {"top_features": []}
                try:
                    explanations = explainer.explain_prediction(
                        features=result["features"],
                        model_version=mv,
                        base_value=result.get("base_value", 0.0),
                    )
                except Exception as explain_err:
                    logger.warning(
                        f"All-model explainability unavailable for {mv.version_tag}: {explain_err}",
                        exc_info=True,
                    )

                items.append(
                    MultiModelPredictionItem(
                        model_version_id=mv.model_version_id,
                        model_version=mv.version_tag,
                        model_type=mv.model_type,
                        is_production=bool(mv.is_production),
                        predicted_yield=result["predicted_yield"],
                        confidence_interval=[
                            result["confidence_lower"],
                            result["confidence_upper"],
                        ],
                        confidence_level=result.get("confidence_level"),
                        explainability={
                            "top_features": [
                                FeatureContribution(
                                    feature=feat["feature"],
                                    value=feat["value"],
                                    direction=feat["direction"],
                                    importance=feat["importance"],
                                ).model_dump()
                                for feat in explanations.get("top_features", [])[:5]
                            ]
                        },
                        error=None,
                    )
                )
            except Exception as exc:
                logger.warning(f"All-model prediction failed for {mv.version_tag}: {exc}")
                items.append(
                    MultiModelPredictionItem(
                        model_version_id=mv.model_version_id,
                        model_version=mv.version_tag,
                        model_type=mv.model_type,
                        is_production=bool(mv.is_production),
                        predicted_yield=None,
                        confidence_interval=None,
                        explainability={"top_features": []},
                        error=str(exc),
                    )
                )

        # Production first, then version_tag for stable ordering.
        items.sort(key=lambda x: (not x.is_production, x.model_version))
        return MultiModelPredictionResponse(request=payload, predictions=items)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"All-model prediction error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"All-model prediction failed: {str(e)}"
        )


@router.post("/batch", summary="Batch predict yield")
async def batch_predict_yield(
    requests: List[PredictionRequest],
    db: Session = Depends(get_db),
):
    """
    Predict yield for multiple fields in batch.

    Accepts a list of prediction requests.
    Returns a list of predictions in the same order.
    """
    try:
        predictor = PredictionService(db)
        model_version = predictor.get_production_model()

        if not model_version:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No production model available"
            )

        results = []
        for req in requests:
            try:
                result = predictor.predict(req.model_dump(exclude_none=True), model_version)
                results.append(PredictionResponse(
                    predicted_yield=result['predicted_yield'],
                    confidence_interval=[
                        result['confidence_lower'],
                        result['confidence_upper']
                    ],
                    confidence_level=result.get('confidence_level'),
                    model_version=model_version.version_tag,
                    regional_comparison=None,
                    explainability=None,
                    recommendations=None,
                ).model_dump())
            except Exception as e:
                logger.error(f"Batch prediction failed for item: {e}")
                results.append({
                    "error": str(e),
                    "predicted_yield": None,
                    "confidence_interval": None,
                    "model_version": model_version.version_tag if model_version else None,
                })

        return {"predictions": results, "total": len(requests)}

    except Exception as e:
        logger.error(f"Batch prediction error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch prediction failed: {str(e)}"
        )


@router.get("/history", response_model=List[PredictionRunResponse], summary="List saved prediction runs")
async def list_prediction_runs(
    db: Session = Depends(get_db),
    limit: int = 100,
    page: int = 1,
    crop: Optional[str] = None,
    model_version_id: Optional[int] = None,
):
    """
    List persisted ad-hoc prediction runs created by prediction endpoints.
    """
    safe_limit = min(max(limit, 1), 500)
    safe_page = max(page, 1)
    skip = (safe_page - 1) * safe_limit

    runs = crud.get_prediction_runs(
        db,
        skip=skip,
        limit=safe_limit,
        crop=crop,
        model_version_id=model_version_id,
    )
    return [_serialize_prediction_run(run) for run in runs]


def _compute_scatter_metrics(points: List[Dict[str, float]]) -> Dict[str, Optional[float]]:
    """Compute the diagnostic-plot statistics that the frontend renders in
    the card header. All formulas are unweighted and use n-1 / n where
    standard for sample stats:

      R²      — 1 - SSE/SST, the coefficient of determination of
                predicted vs observed. Negative when the model is worse
                than predicting the mean.
      RMSE    — sqrt( mean( (predicted - observed)² ) ).
      MAE     — mean( |predicted - observed| ).
      bias    — mean residual (predicted - observed). Positive = the
                model systematically over-predicts.
      slope,  — ordinary-least-squares fit of `predicted = slope *
      intercept observed + intercept`. Slope of 1 + intercept of 0 means
                the model tracks the 1:1 line perfectly.
    """
    n = len(points)
    if n < 2:
        return {
            "n": n,
            "r2": None,
            "rmse": None,
            "mae": None,
            "bias": None,
            "slope": None,
            "intercept": None,
            "observed_min": None,
            "observed_max": None,
            "predicted_min": None,
            "predicted_max": None,
        }

    obs = [p["observed"] for p in points]
    pred = [p["predicted"] for p in points]
    residuals = [pred[i] - obs[i] for i in range(n)]

    obs_mean = sum(obs) / n
    pred_mean = sum(pred) / n

    sse = sum(r * r for r in residuals)
    sst = sum((o - obs_mean) ** 2 for o in obs)
    r2 = 1.0 - (sse / sst) if sst > 0 else None
    rmse = math.sqrt(sse / n)
    mae = sum(abs(r) for r in residuals) / n
    bias = sum(residuals) / n

    # OLS regression of predicted on observed.
    num = sum((obs[i] - obs_mean) * (pred[i] - pred_mean) for i in range(n))
    den = sum((obs[i] - obs_mean) ** 2 for i in range(n))
    if den > 0:
        slope = num / den
        intercept = pred_mean - slope * obs_mean
    else:
        slope = None
        intercept = None

    return {
        "n": n,
        "r2": r2,
        "rmse": rmse,
        "mae": mae,
        "bias": bias,
        "slope": slope,
        "intercept": intercept,
        "observed_min": min(obs),
        "observed_max": max(obs),
        "predicted_min": min(pred),
        "predicted_max": max(pred),
    }


@router.get(
    "/scatter",
    summary="Predicted vs observed pairs + regression metrics for a model",
)
async def get_prediction_scatter(
    db: Session = Depends(get_db),
    model_id: Optional[int] = Query(
        None,
        description="Model version id. Defaults to the production model if unset.",
    ),
    season: Optional[List[int]] = Query(
        None,
        description=(
            "Optional filter — restrict to one or more season years (repeat the "
            "query param to pass multiple, e.g. season=2023&season=2024). "
            "Helpful for matching the slice your training set was cut on."
        ),
    ),
    state: Optional[str] = Query(
        None,
        description="Optional filter — restrict to a single state (e.g. 'Kansas').",
    ),
    limit: int = Query(
        5000,
        ge=1,
        le=20000,
        description="Hard cap on points returned. Use a smaller number for snappier scatter renders.",
    ),
):
    """Return all (predicted, observed) pairs for a given model plus the
    standard diagnostic statistics. Powers the Model Regression card on
    the Analytics → Model & Data view.

    Only includes field-seasons that have both a stored prediction for
    the requested model AND a non-null observed `yield_bu_ac`. Field-
    seasons where either side is missing are excluded so the metrics
    aren't biased by half-pairs.

    The `season` and `state` query params let callers narrow the slice
    to match their training subset, which often raises R² substantially
    (the full prediction set includes out-of-time / out-of-geography
    field-seasons that the model was never tuned on).
    """
    # Resolve the model. Fall back to the production model if no id was
    # supplied — the frontend will use this to label its initial render.
    if model_id is None:
        mv = (
            db.query(db_models.ModelVersion)
            .filter(db_models.ModelVersion.is_production.is_(True))
            .first()
        )
    else:
        mv = db.get(db_models.ModelVersion, model_id)

    if mv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No production model registered."
                if model_id is None
                else f"Model version {model_id} not found."
            ),
        )

    # Build the joined query. We always pull season_year and field.state
    # alongside the value columns so the response can carry them on each
    # point (cheap; same row already joined) — that lets the frontend show
    # which slice each point belongs to in hover tooltips and lets us
    # echo the filters back without a second round-trip.
    query = (
        db.query(
            db_models.ModelPrediction.field_season_id,
            db_models.ModelPrediction.predicted_yield,
            db_models.FieldSeason.yield_bu_ac,
            db_models.Field.field_number,
            db_models.Field.state,
            db_models.FieldSeason.season_id,
            db_models.Season.season_year,
        )
        .join(
            db_models.FieldSeason,
            db_models.ModelPrediction.field_season_id == db_models.FieldSeason.field_season_id,
        )
        .join(
            db_models.Field,
            db_models.FieldSeason.field_id == db_models.Field.field_id,
        )
        .join(
            db_models.Season,
            db_models.FieldSeason.season_id == db_models.Season.season_id,
        )
        .filter(
            db_models.ModelPrediction.model_version_id == mv.model_version_id,
            db_models.ModelPrediction.predicted_yield.is_not(None),
            db_models.FieldSeason.yield_bu_ac.is_not(None),
        )
    )

    if season:
        query = query.filter(db_models.Season.season_year.in_(season))
    if state:
        # Postgres ILIKE keeps the filter case-insensitive so the UI can
        # pass "kansas" or "Kansas" interchangeably.
        query = query.filter(db_models.Field.state.ilike(state))

    rows = query.limit(limit).all()

    points: List[Dict[str, Any]] = []
    for fs_id, predicted, observed, field_number, field_state, season_id, season_year in rows:
        try:
            p = float(predicted)
            o = float(observed)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(p) and math.isfinite(o)):
            continue
        points.append(
            {
                "field_season_id": fs_id,
                "field_number": field_number,
                "state": field_state,
                "season_id": season_id,
                "season_year": season_year,
                "observed": o,
                "predicted": p,
                "residual": p - o,
            }
        )

    metrics = _compute_scatter_metrics(points)

    # Distinct seasons + states across the unfiltered prediction set for
    # this model — used by the frontend to populate the filter dropdowns
    # with only values that have at least one matching point. This is one
    # extra lightweight query but it means the dropdowns can't offer
    # impossible combinations.
    available = (
        db.query(
            db_models.Season.season_year,
            db_models.Field.state,
        )
        .join(
            db_models.FieldSeason,
            db_models.FieldSeason.season_id == db_models.Season.season_id,
        )
        .join(
            db_models.Field,
            db_models.FieldSeason.field_id == db_models.Field.field_id,
        )
        .join(
            db_models.ModelPrediction,
            db_models.ModelPrediction.field_season_id == db_models.FieldSeason.field_season_id,
        )
        .filter(
            db_models.ModelPrediction.model_version_id == mv.model_version_id,
            db_models.ModelPrediction.predicted_yield.is_not(None),
            db_models.FieldSeason.yield_bu_ac.is_not(None),
        )
        .distinct()
        .all()
    )
    available_seasons = sorted({y for y, _ in available if y is not None})
    available_states = sorted({s for _, s in available if s})

    return {
        "model_version": {
            "model_version_id": mv.model_version_id,
            "version_tag": mv.version_tag,
            "model_type": mv.model_type,
            "is_production": bool(mv.is_production),
        },
        "filters_applied": {
            "season": list(season) if season else None,
            "state": state,
        },
        "available_filters": {
            "seasons": available_seasons,
            "states": available_states,
        },
        "metrics": metrics,
        "points": points,
        "truncated": len(points) >= limit,
    }


# Helper function for logging
def log_prediction_request(
    request: PredictionRequest,
    response: PredictionResponse,
    model_version: str,
):
    """
    Log prediction requests for monitoring and future training.
    This can be expanded to store in a predictions_log table.
    """
    logger.info(
        f"Prediction made: crop={request.crop}, variety={request.variety}, "
        f"season={request.season}, model={model_version}, "
        f"predicted_yield={response.predicted_yield}"
    )
    # Future: Store in database

"""
Prediction endpoints - ML model inference
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
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
    - season: Year (e.g., 2025)
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
        if not county or not state:
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

        # Generate prediction
        prediction_result = predictor.predict(request.model_dump(), model_version)

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
            logger.warning(f"Explainability unavailable for model {model_version.version_tag}: {explain_err}")

        # Build response
        response = PredictionResponse(
            predicted_yield=prediction_result['predicted_yield'],
            confidence_interval=[
                prediction_result['confidence_lower'],
                prediction_result['confidence_upper']
            ],
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
        )

        request_payload = request.model_dump(mode="json")
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
        if not county or not state:
            regional_comparison = None
        else:
            regional_stats = RegionalStatsService(db)
            regional_comparison = regional_stats.get_county_avg(
                crop=request.crop,
                season=request.season,
                state=state,
                county=county
            )

        prediction_result = predictor.predict(request.model_dump(), model_version=model_version)

        explanations = {"top_features": []}
        try:
            explainer = ExplainabilityEngine(db, predictor)
            explanations = explainer.explain_prediction(
                features=prediction_result['features'],
                model_version=model_version,
                base_value=prediction_result.get('base_value', 0.0)
            )
        except Exception as explain_err:
            logger.warning(f"Explainability unavailable for model {model_version.version_tag}: {explain_err}")

        response = PredictionResponse(
            predicted_yield=prediction_result['predicted_yield'],
            confidence_interval=[
                prediction_result['confidence_lower'],
                prediction_result['confidence_upper']
            ],
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

        request_payload = request.model_dump(mode="json")
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

        payload = request.model_dump()
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
                    logger.warning(f"All-model explainability unavailable for {mv.version_tag}: {explain_err}")

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
                result = predictor.predict(req.model_dump(), model_version)
                results.append(PredictionResponse(
                    predicted_yield=result['predicted_yield'],
                    confidence_interval=[
                        result['confidence_lower'],
                        result['confidence_upper']
                    ],
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

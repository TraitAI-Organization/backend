"""
Prediction endpoints - ML model inference
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Dict, Any, List
import logging

from app.database.session import get_db
from app.database import crud
from app.database.schemas import PredictionRequest, PredictionResponse, FeatureContribution
from app.ml.predictor import PredictionService
from app.ml.explainability import ExplainabilityEngine
from app.services.regional_stats import RegionalStatsService

logger = logging.getLogger(__name__)

router = APIRouter()


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

        # Get explainability
        explainer = ExplainabilityEngine(db, predictor)
        explanations = explainer.explain_prediction(
            features=prediction_result['features'],
            model_version=model_version,
            base_value=prediction_result.get('base_value', 0.0)
        )

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
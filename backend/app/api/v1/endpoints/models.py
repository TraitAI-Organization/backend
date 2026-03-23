"""
Model management endpoints
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
import logging

from app.database.session import get_db
from app.database import crud
from app.database.schemas import (
    ModelVersionCreate,
    ModelVersionResponse,
    ModelVersionDetailResponse,
)
from app.ml.model_registry import ModelRegistry
from app.ml.trainer import ModelTrainer

logger = logging.getLogger(__name__)

router = APIRouter()


def _sanitize_metrics(metrics: Optional[dict]) -> dict:
    """
    Convert metrics payload to Dict[str, float] to satisfy response schema.
    Non-numeric values are dropped.
    """
    if not isinstance(metrics, dict):
        return {}

    out = {}
    for key, value in metrics.items():
        if isinstance(value, (int, float)):
            out[key] = float(value)
    return out


def _to_model_version_response(mv) -> ModelVersionResponse:
    return ModelVersionResponse(
        model_version_id=mv.model_version_id,
        version_tag=mv.version_tag,
        model_type=mv.model_type,
        model_params=mv.model_params or {},
        training_data_range=mv.training_data_range,
        performance_metrics=_sanitize_metrics(mv.performance_metrics),
        training_date=mv.training_date,
        is_production=mv.is_production,
        feature_list=mv.feature_list or [],
        preprocessing_steps=mv.preprocessing_steps,
        notes=mv.notes,
        created_by=mv.created_by,
    )


@router.get("/versions", response_model=List[ModelVersionResponse], summary="List model versions")
async def list_model_versions(
    db: Session = Depends(get_db),
    limit: int = 20,
    active_only: bool = False,
):
    """
    Get list of trained model versions.

    **active_only**: If true, returns only the latest version for each model_type.
    """
    versions = crud.get_model_versions(db, limit=limit, active_only=active_only)
    return [_to_model_version_response(v) for v in versions]


@router.get("/versions/{version_id}", response_model=ModelVersionDetailResponse, summary="Get model version details")
async def get_model_version(
    version_id: int,
    db: Session = Depends(get_db),
):
    """
    Get detailed information about a specific model version.
    """
    mv = crud.get_model_version(db, version_id)
    if not mv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model version {version_id} not found"
        )

    # Include training run info
    response = ModelVersionDetailResponse(
        model_version_id=mv.model_version_id,
        version_tag=mv.version_tag,
        model_type=mv.model_type,
        model_params=mv.model_params,
        training_data_range=mv.training_data_range,
        performance_metrics=_sanitize_metrics(mv.performance_metrics),
        training_date=mv.training_date,
        is_production=mv.is_production,
        feature_list=mv.feature_list,
        preprocessing_steps=mv.preprocessing_steps,
        notes=mv.notes,
        created_by=mv.created_by,
        training_runs=[
            {
                "run_id": r.run_id,
                "git_commit_hash": r.git_commit_hash,
                "training_duration_seconds": r.training_duration_seconds,
                "training_records": r.training_records,
                "validation_records": r.validation_records,
                "status": r.status,
                "started_at": r.started_at,
                "completed_at": r.completed_at,
                "error_message": r.error_message,
            }
            for r in mv.training_runs
        ]
    )

    return response


@router.post("/train", summary="Trigger model training")
async def train_model(
    background_tasks: BackgroundTasks,
    model_type: str = Query("lightgbm", description="Model type: lightgbm, xgboost, random_forest"),
    start_season: int = Query(2018, description="Start season year for training data"),
    end_season: int = Query(2024, description="End season year for training data"),
    test_size: float = Query(0.2, description="Proportion of data for validation", ge=0.1, le=0.5),
    db: Session = Depends(get_db),
):
    """
    Trigger asynchronous model training.

    This will:
    1. Query training data from database (field-seasons with observed yields)
    2. Perform feature engineering
    3. Train model with cross-validation
    4. Evaluate metrics
    5. Save model artifacts and register in database
    6. Optionally set as production (configurable)

    Returns a run_id that can be used to track training status.
    """
    try:
        # Start training in background
        trainer = ModelTrainer(db)

        # Run training (this is blocking; could be moved to Celery)
        result = trainer.train(
            model_type=model_type,
            start_season=start_season,
            end_season=end_season,
            test_size=test_size,
        )

        return {
            "status": "success",
            "model_version_id": result["model_version_id"],
            "version_tag": result["version_tag"],
            "metrics": result["metrics"],
            "training_records": result["training_records"],
            "validation_records": result["validation_records"],
            "message": "Model trained and registered successfully.",
        }

    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Training failed: {str(e)}"
        )


@router.post("/versions/{version_id}/set-production", summary="Set model as production")
async def set_production_model(
    version_id: int,
    db: Session = Depends(get_db),
):
    """
    Set a specific model version as the production model.

    This will unset any currently active production model.
    """
    mv = crud.set_production_model(db, version_id)
    if not mv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model version {version_id} not found"
        )

    return {
        "status": "success",
        "message": f"Model version {version_id} is now in production",
        "model_version": mv.version_tag,
    }


@router.get("/production", summary="Get current production model")
async def get_production_model(
    db: Session = Depends(get_db),
):
    """
    Get information about the current production model.
    """
    mv = crud.get_production_model_version(db)
    if not mv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No production model is currently set"
        )

    return _to_model_version_response(mv)


@router.get("/performance", summary="Get model performance metrics")
async def get_model_performance(
    db: Session = Depends(get_db),
    model_version: Optional[str] = None,
):
    """
    Get performance metrics for models.

    If model_version is provided, returns metrics for that specific version.
    Otherwise, returns metrics for all versions.
    """
    if model_version:
        # Query specific version
        from app.database import models
        mv = (
            db.query(models.ModelVersion)
            .filter(models.ModelVersion.version_tag == model_version)
            .first()
        )
        if not mv:
            raise HTTPException(status_code=404, detail="Model version not found")
        return [{
            "version": mv.version_tag,
            "metrics": mv.performance_metrics,
            "training_date": mv.training_date.isoformat() if mv.training_date else None,
            "training_records": mv.training_data_range.get("record_count") if mv.training_data_range else None,
        }]

    # All versions
    versions = crud.get_model_versions(db, limit=100)
    return [
        {
            "version": v.version_tag,
            "model_type": v.model_type,
            "metrics": v.performance_metrics,
            "training_date": v.training_date.isoformat() if v.training_date else None,
            "is_production": v.is_production,
        }
        for v in versions
    ]

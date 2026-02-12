"""
Fields endpoint - filtering, listing, details
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import math

from app.database.session import get_db
from app.database import crud
from app.database.schemas import (
    FieldSeasonResponse,
    FieldSeasonDetailResponse,
    OverviewResponse,
    PaginatedResponse,
    PaginationParams,
)

router = APIRouter()


@router.get("/overview", response_model=OverviewResponse, summary="Dashboard overview")
async def get_overview(
    db: Session = Depends(get_db),
):
    """
    Get overall statistics for the dashboard.
    Returns counts, available filters, and yield ranges.
    """
    stats = crud.get_overview_stats(db)

    # Get latest model version info
    from app.ml.model_registry import ModelRegistry
    registry = ModelRegistry(db)
    model_versions = registry.get_latest_versions(limit=5)

    stats["model_versions"] = model_versions

    return stats


@router.get("", response_model=PaginatedResponse, summary="List field-season records")
async def list_field_seasons(
    db: Session = Depends(get_db),
    # Filters
    crop: Optional[str] = Query(None, description="Crop name (partial match)"),
    variety: Optional[str] = Query(None, description="Variety name (partial match)"),
    season: Optional[List[int]] = Query(None, description="Season year(s)"),
    state: Optional[str] = Query(None, description="State name"),
    county: Optional[str] = Query(None, description="County name"),
    min_acres: Optional[float] = Query(None, ge=0, description="Minimum acres"),
    max_acres: Optional[float] = Query(None, ge=0, description="Maximum acres"),
    has_prediction: Optional[bool] = Query(None, description="Filter by prediction availability"),
    min_yield: Optional[float] = Query(None, description="Minimum predicted yield (requires has_prediction=true)"),
    max_yield: Optional[float] = Query(None, description="Maximum predicted yield (requires has_prediction=true)"),
    # Pagination
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
):
    """
    Get paginated list of field-season records with filtering.

    **Filters:**
    - `crop` (e.g., "Sorghum", "Wheat, Hard Winter", "Corn")
    - `variety` (e.g., "Pioneer 86P20", "Grainfield")
    - `season` (e.g., 2025, [2024, 2025])
    - `state` (e.g., "Kansas")
    - `county` (e.g., "Ford")
    - `min_acres`, `max_acres` (field size range)
    - `has_prediction` (true/false - only show fields with predictions)
    - `min_yield`, `max_yield` (predicted yield range)

    **Response includes:**
    - Field details (field number, acres, location)
    - Crop and variety
    - Season
    - Observed yield (if available)
    - Predicted yield (if available) - field_seasons with ids will have predictions pre-fetched

    Returns paginated results with total count.
    """
    skip = (page - 1) * limit

    # Get total count for pagination
    total = crud.count_field_seasons(
        db=db,
        crop=crop,
        variety=variety,
        season=season,
        state=state,
        county=county,
        min_acres=min_acres,
        max_acres=max_acres,
        has_prediction=has_prediction,
    )

    # Get data
    field_seasons = crud.get_field_seasons(
        db=db,
        skip=skip,
        limit=limit,
        crop=crop,
        variety=variety,
        season=season,
        state=state,
        county=county,
        min_acres=min_acres,
        max_acres=max_acres,
        has_prediction=has_prediction,
        min_yield=min_yield,
        max_yield=max_yield,
    )

    # Build response items with essential info
    data = []
    for fs in field_seasons:
        item = {
            "field_season_id": fs.field_season_id,
            "field_number": fs.field.field_number if fs.field else None,
            "acres": float(fs.field.acres) if fs.field else None,
            "crop": fs.crop.crop_name_en if fs.crop else None,
            "variety": fs.variety.variety_name_en if fs.variety else None,
            "season": fs.season.season_year if fs.season else None,
            "state": fs.field.state if fs.field else None,
            "county": fs.field.county if fs.field else None,
            "lat": float(fs.field.lat) if fs.field and fs.field.lat else None,
            "long": float(fs.field.long) if fs.field and fs.field.long else None,
            "yield_bu_ac": float(fs.yield_bu_ac) if fs.yield_bu_ac else None,
            "totalN_per_ac": float(fs.totalN_per_ac) if fs.totalN_per_ac else None,
            "totalP_per_ac": float(fs.totalP_per_ac) if fs.totalP_per_ac else None,
            "totalK_per_ac": float(fs.totalK_per_ac) if fs.totalK_per_ac else None,
        }

        # Add prediction if available (assuming latest prediction is loaded)
        if fs.predictions:
            latest_pred = sorted(
                fs.predictions, key=lambda x: x.created_at, reverse=True
            )[0]
            item["predicted_yield"] = float(latest_pred.predicted_yield)
            item["confidence_interval"] = [
                float(latest_pred.confidence_lower),
                float(latest_pred.confidence_upper),
            ]
            item["regional_avg_yield"] = (
                float(latest_pred.regional_avg_yield)
                if latest_pred.regional_avg_yield
                else None
            )
        else:
            item["predicted_yield"] = None
            item["confidence_interval"] = None
            item["regional_avg_yield"] = None

        # Management event count
        item["management_event_count"] = len(fs.management_events) if fs.management_events else 0

        data.append(item)

    return {
        "data": data,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": math.ceil(total / limit) if total > 0 else 0,
    }


@router.get("/{field_season_id}", response_model=FieldSeasonDetailResponse, summary="Get field-season details")
async def get_field_season_detail(
    field_season_id: int,
    db: Session = Depends(get_db),
):
    """
    Get detailed information for a specific field-season record.

    Includes:
    - Field info (acres, location, grower)
    - Crop and variety
    - Season
    - Observed yield and target
    - Nutrient totals (N, P, K)
    - All management events (timeline of operations)
    - Prediction history (if available)
    - Data quality flags
    """
    fs = crud.get_field_season_with_details(db, field_season_id)
    if not fs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field-season with id {field_season_id} not found"
        )

    # Build response
    response = {
        "field_season_id": fs.field_season_id,
        "field_id": fs.field_id,
        "crop_id": fs.crop_id,
        "variety_id": fs.variety_id,
        "season_id": fs.season_id,
        "yield_bu_ac": float(fs.yield_bu_ac) if fs.yield_bu_ac else None,
        "yield_target": float(fs.yield_target) if fs.yield_target else None,
        "totalN_per_ac": float(fs.totalN_per_ac) if fs.totalN_per_ac else None,
        "totalP_per_ac": float(fs.totalP_per_ac) if fs.totalP_per_ac else None,
        "totalK_per_ac": float(fs.totalK_per_ac) if fs.totalK_per_ac else None,
        "record_source": fs.record_source,
        "data_quality_score": float(fs.data_quality_score) if fs.data_quality_score else None,
        "missing_data_flags": fs.missing_data_flags,
        "created_at": fs.created_at,
        # Joined data
        "field": {
            "field_id": fs.field.field_id,
            "field_number": fs.field.field_number,
            "acres": float(fs.field.acres) if fs.field.acres else None,
            "lat": float(fs.field.lat) if fs.field.lat else None,
            "long": float(fs.field.long) if fs.field.long else None,
            "county": fs.field.county,
            "state": fs.field.state,
            "grower_id": fs.field.grower_id,
        } if fs.field else None,
        "crop": {
            "crop_id": fs.crop.crop_id,
            "crop_name_en": fs.crop.crop_name_en,
        } if fs.crop else None,
        "variety": {
            "variety_id": fs.variety.variety_id,
            "variety_name_en": fs.variety.variety_name_en,
        } if fs.variety else None,
        "season": {
            "season_id": fs.season.season_id,
            "season_year": fs.season.season_year,
        } if fs.season else None,
        "management_events": [
            {
                "event_id": ev.event_id,
                "job_id": ev.job_id,
                "event_type": ev.event_type,
                "status": ev.status,
                "start_date": ev.start_date.isoformat() if ev.start_date else None,
                "end_date": ev.end_date.isoformat() if ev.end_date else None,
                "application_area": float(ev.application_area) if ev.application_area else None,
                "amount": float(ev.amount) if ev.amount else None,
                "description": ev.description,
                "fert_units": ev.fert_units,
                "rate": float(ev.rate) if ev.rate else None,
                "fertilizer_id": ev.fertilizer_id,
                "blend_name": ev.blend_name,
                "chemical_type": ev.chemical_type,
                "chem_product": ev.chem_product,
                "water_applied_mm": float(ev.water_applied_mm) if ev.water_applied_mm else None,
                "irrigation_method": ev.irrigation_method,
                "machine_make1": ev.machine_make1,
                "machine_model1": ev.machine_model1,
            }
            for ev in sorted(fs.management_events, key=lambda x: x.start_date or x.created_at)
        ],
        "predictions": [
            {
                "prediction_id": pred.prediction_id,
                "predicted_yield": float(pred.predicted_yield),
                "confidence_lower": float(pred.confidence_lower),
                "confidence_upper": float(pred.confidence_upper),
                "regional_avg_yield": float(pred.regional_avg_yield) if pred.regional_avg_yield else None,
                "feature_contributions": pred.feature_contributions,
                "created_at": pred.created_at.isoformat(),
                "model_version": {
                    "model_version_id": pred.model_version.model_version_id,
                    "version_tag": pred.model_version.version_tag,
                    "model_type": pred.model_version.model_type,
                } if pred.model_version else None,
            }
            for pred in sorted(fs.predictions, key=lambda x: x.created_at, reverse=True)
        ],
    }

    return response


@router.get("/crops/", summary="List all crops")
async def list_crops(
    db: Session = Depends(get_db),
    active_only: bool = Query(True, description="Only return active crops"),
):
    """
    Get list of all crops in the system.
    """
    from app.database import crud
    crops = crud.get_crops(db, active_only=active_only)
    return [
        {"crop_id": c.crop_id, "crop_name_en": c.crop_name_en, "is_active": c.is_active}
        for c in crops
    ]


@router.get("/varieties/", summary="List varieties")
async def list_varieties(
    db: Session = Depends(get_db),
    crop: Optional[str] = Query(None, description="Filter by crop name"),
    active_only: bool = Query(True, description="Only return active varieties"),
):
    """
    Get list of varieties, optionally filtered by crop.
    """
    from app.database import crud
    if crop:
        crop_obj = crud.get_crop_by_name(db, crop)
        if not crop_obj:
            raise HTTPException(status_code=404, detail=f"Crop '{crop}' not found")
        varieties = crud.get_varieties_by_crop(db, crop_obj.crop_id, active_only=active_only)
    else:
        from app.database import models
        query = db.query(models.Variety)
        if active_only:
            query = query.filter(models.Variety.is_active == True)
        varieties = query.all()

    return [
        {
            "variety_id": v.variety_id,
            "variety_name_en": v.variety_name_en,
            "crop_id": v.crop_id,
            "is_active": v.is_active,
        }
        for v in varieties
    ]


@router.get("/seasons/", summary="List seasons")
async def list_seasons(
    db: Session = Depends(get_db),
):
    """
    Get list of all seasons in the system.
    """
    from app.database import crud
    seasons = crud.get_seasons(db)
    return [
        {"season_id": s.season_id, "season_year": s.season_year, "is_current": s.is_current}
        for s in seasons
    ]
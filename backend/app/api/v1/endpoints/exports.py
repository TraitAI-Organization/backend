"""
Export endpoints - CSV downloads, field summaries
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, List
import io
import csv
import json

from app.database.session import get_db
from app.database import crud
from app.database.schemas import ExportRequest

router = APIRouter()


@router.get("/csv", summary="Export filtered data as CSV")
async def export_csv(
    db: Session = Depends(get_db),
    crop: Optional[str] = Query(None),
    variety: Optional[str] = Query(None),
    season: Optional[List[int]] = Query(None),
    state: Optional[str] = Query(None),
    county: Optional[str] = Query(None),
    min_acres: Optional[float] = Query(None),
    max_acres: Optional[float] = Query(None),
    has_prediction: Optional[bool] = Query(None),
    min_yield: Optional[float] = Query(None),
    max_yield: Optional[float] = Query(None),
):
    """
    Export filtered field-season data as CSV.

    Same filters as `/api/v1/fields/` endpoint.
    Returns a downloadable CSV file.
    """
    # Get all matching records (no pagination for export)
    field_seasons = crud.get_field_seasons(
        db=db,
        skip=0,
        limit=100000,  # Large limit, but we'll handle big exports carefully
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

    # Build CSV
    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    headers = [
        "field_season_id",
        "field_number",
        "acres",
        "crop",
        "variety",
        "season",
        "state",
        "county",
        "lat",
        "long",
        "yield_bu_ac",
        "predicted_yield",
        "confidence_lower",
        "confidence_upper",
        "regional_avg_yield",
        "totalN_per_ac",
        "totalP_per_ac",
        "totalK_per_ac",
        "management_event_count",
    ]
    writer.writerow(headers)

    # Rows
    for fs in field_seasons:
        # Get latest prediction if exists
        latest_pred = None
        if fs.predictions:
            latest_pred = sorted(fs.predictions, key=lambda x: x.created_at, reverse=True)[0]

        row = [
            fs.field_season_id,
            fs.field.field_number if fs.field else "",
            float(fs.field.acres) if fs.field and fs.field.acres else "",
            fs.crop.crop_name_en if fs.crop else "",
            fs.variety.variety_name_en if fs.variety else "",
            fs.season.season_year if fs.season else "",
            fs.field.state if fs.field else "",
            fs.field.county if fs.field else "",
            float(fs.field.lat) if fs.field and fs.field.lat else "",
            float(fs.field.long) if fs.field and fs.field.long else "",
            float(fs.yield_bu_ac) if fs.yield_bu_ac else "",
            float(latest_pred.predicted_yield) if latest_pred else "",
            float(latest_pred.confidence_lower) if latest_pred else "",
            float(latest_pred.confidence_upper) if latest_pred else "",
            float(latest_pred.regional_avg_yield) if latest_pred and latest_pred.regional_avg_yield else "",
            float(fs.totalN_per_ac) if fs.totalN_per_ac else "",
            float(fs.totalP_per_ac) if fs.totalP_per_ac else "",
            float(fs.totalK_per_ac) if fs.totalK_per_ac else "",
            len(fs.management_events) if fs.management_events else 0,
        ]
        writer.writerow(row)

    output.seek(0)

    # Create response
    filename = f"nutrition_export_{crop or 'all'}_{state or 'all'}.csv"
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/field/{field_season_id}/summary", summary="Export single field-season summary")
async def export_field_summary(
    field_season_id: int,
    format: str = Query("json", description="Export format: json or csv", regex="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    """
    Get a detailed summary of a single field-season, including:
    - Field metadata
    - All management events
    - Observed and predicted yields
    - Input summaries
    - Regional comparison

    Can be exported as JSON or CSV.
    """
    fs = crud.get_field_season_with_details(db, field_season_id)
    if not fs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field-season {field_season_id} not found"
        )

    # Build summary
    summary = {
        "field_season_id": fs.field_season_id,
        "field": {
            "field_number": fs.field.field_number if fs.field else None,
            "acres": float(fs.field.acres) if fs.field and fs.field.acres else None,
            "location": {
                "lat": float(fs.field.lat) if fs.field and fs.field.lat else None,
                "long": float(fs.field.long) if fs.field and fs.field.long else None,
                "county": fs.field.county,
                "state": fs.field.state,
            } if fs.field else None,
            "grower_id": fs.field.grower_id if fs.field else None,
        },
        "crop": {
            "crop_name": fs.crop.crop_name_en if fs.crop else None,
            "variety": fs.variety.variety_name_en if fs.variety else None,
        },
        "season": fs.season.season_year if fs.season else None,
        "yields": {
            "observed_bu_ac": float(fs.yield_bu_ac) if fs.yield_bu_ac else None,
            "target_bu_ac": float(fs.yield_target) if fs.yield_target else None,
        },
        "nutrients": {
            "totalN_lb_per_ac": float(fs.totalN_per_ac) if fs.totalN_per_ac else None,
            "totalP_lb_per_ac": float(fs.totalP_per_ac) if fs.totalP_per_ac else None,
            "totalK_lb_per_ac": float(fs.totalK_per_ac) if fs.totalK_per_ac else None,
        },
        "management_events": [
            {
                "event_type": ev.event_type,
                "status": ev.status,
                "start_date": ev.start_date.isoformat() if ev.start_date else None,
                "end_date": ev.end_date.isoformat() if ev.end_date else None,
                "application_area_ac": float(ev.application_area) if ev.application_area else None,
                "amount": float(ev.amount) if ev.amount else None,
                "description": ev.description,
                "fert_units": ev.fert_units,
                "rate": float(ev.rate) if ev.rate else None,
                "chemical_type": ev.chemical_type,
                "chem_product": ev.chem_product,
                "water_applied_mm": float(ev.water_applied_mm) if ev.water_applied_mm else None,
                "irrigation_method": ev.irrigation_method,
            }
            for ev in sorted(fs.management_events, key=lambda x: x.start_date or x.created_at)
        ],
        "predictions": [
            {
                "predicted_yield": float(p.predicted_yield),
                "confidence_interval": [float(p.confidence_lower), float(p.confidence_upper)],
                "regional_avg_yield": float(p.regional_avg_yield) if p.regional_avg_yield else None,
                "model_version": p.model_version.version_tag if p.model_version else None,
                "created_at": p.created_at.isoformat(),
            }
            for p in sorted(fs.predictions, key=lambda x: x.created_at, reverse=True)
        ],
        "data_quality": {
            "data_quality_score": float(fs.data_quality_score) if fs.data_quality_score else None,
            "missing_data_flags": fs.missing_data_flags,
            "record_source": fs.record_source,
        },
        "generated_at": "2025-02-11T00:00:00Z",  # TODO: use datetime.utcnow()
    }

    if format.lower() == "json":
        return summary

    # CSV format
    output = io.StringIO()
    writer = csv.writer(output)

    # Flatten summary for CSV (simple approach: single row with key fields)
    writer.writerow([
        "field_season_id",
        "field_number",
        "acres",
        "crop",
        "variety",
        "season",
        "state",
        "county",
        "observed_yield",
        "target_yield",
        "totalN",
        "totalP",
        "totalK",
        "num_events",
        "latest_predicted_yield",
        "confidence_lower",
        "confidence_upper",
        "regional_avg",
    ])

    latest_pred = None
    if fs.predictions:
        latest_pred = sorted(fs.predictions, key=lambda x: x.created_at, reverse=True)[0]

    writer.writerow([
        fs.field_season_id,
        fs.field.field_number if fs.field else "",
        float(fs.field.acres) if fs.field and fs.field.acres else "",
        fs.crop.crop_name_en if fs.crop else "",
        fs.variety.variety_name_en if fs.variety else "",
        fs.season.season_year if fs.season else "",
        fs.field.state if fs.field else "",
        fs.field.county if fs.field else "",
        float(fs.yield_bu_ac) if fs.yield_bu_ac else "",
        float(fs.yield_target) if fs.yield_target else "",
        float(fs.totalN_per_ac) if fs.totalN_per_ac else "",
        float(fs.totalP_per_ac) if fs.totalP_per_ac else "",
        float(fs.totalK_per_ac) if fs.totalK_per_ac else "",
        len(fs.management_events) if fs.management_events else 0,
        float(latest_pred.predicted_yield) if latest_pred else "",
        float(latest_pred.confidence_lower) if latest_pred else "",
        float(latest_pred.confidence_upper) if latest_pred else "",
        float(latest_pred.regional_avg_yield) if latest_pred and latest_pred.regional_avg_yield else "",
    ])

    output.seek(0)
    filename = f"field_{field_season_id}_summary.csv"

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
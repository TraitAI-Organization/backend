"""
Manual Data Entry endpoints - Form-based data submission
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any
from datetime import datetime
from app.database.session import get_db
from app.database import models
from app.database.schemas import (
    ManualEntryCreate,
    ManualEntryResponse,
)

router = APIRouter()


@router.post("/manual-entry", response_model=ManualEntryResponse, summary="Submit manual field data")
async def submit_manual_entry(
    data: ManualEntryCreate,
    db: Session = Depends(get_db),
):
    """
    Submit agricultural field data through a manual form interface.
    This endpoint processes individual field records submitted via web form.
    
    **Note**: This is a simplified entry point. In production, you would want to:
    - Validate data against business rules
    - Create proper field/season records first
    - Handle multiple management events per field-season
    - Store detailed application data
    """
    try:
        # Check if field exists, create if not
        field = db.query(models.Field).filter(models.Field.field_id == data.field_id).first()
        if not field:
            field = models.Field(
                field_id=data.field_id,
                acres=data.acres,
                lat=data.lat,
                long=data.long,
                grower_id=data.grower,
                field_number=data.field_id,  # Use field_id as field_number temporarily
            )
            db.add(field)
            db.commit()
            db.refresh(field)
        
        # Check if season exists, create if not
        season = db.query(models.Season).filter(models.Season.season_year == data.season).first()
        if not season:
            season = models.Season(
                season_year=data.season,
                season_name=f"{data.season} Season"
            )
            db.add(season)
            db.commit()
            db.refresh(season)
        
        # Create field-season record
        field_season = db.query(models.FieldSeason).filter(
            models.FieldSeason.field_id == data.field_id,
            models.FieldSeason.season_id == season.season_id
        ).first()
        
        if not field_season:
            field_season = models.FieldSeason(
                field_id=data.field_id,
                season_id=season.season_id,
                acres=data.acres,
                total_n=data.totalN_per_ac,
                total_p=data.totalP_per_ac,
                total_k=data.totalK_per_ac,
                yield_observed=data.yield_bu_ac,
                yield_target=data.yield_target,
                county=data.county,
                state=data.state,
                latitude=data.lat,
                longitude=data.long,
                data_source="manual_entry"
            )
            db.add(field_season)
            db.commit()
            db.refresh(field_season)
        
        # Log the ingestion
        ingestion_log = models.DataIngestionLog(
            source_filename="manual_entry",
            file_hash="manual_" + str(data.field_id) + "_" + str(data.season),
            records_parsed=1,
            records_inserted=1,
            records_updated=0,
            records_skipped=0,
            status="completed",
            error_details=None,
            ingestion_started_at=datetime.utcnow(),
            ingestion_completed_at=datetime.utcnow()
        )
        db.add(ingestion_log)
        db.commit()
        
        # Return success response
        return {
            "success": True,
            "message": "Field data submitted successfully",
            "field_season_id": field_season.field_season_id,
            "field_id": data.field_id,
            "season": data.season,
            "crop": data.crop_name_en,
            "status": "completed"
        }
        
    except Exception as e:
        # Log error and return failure
        ingestion_log = models.DataIngestionLog(
            source_filename="manual_entry",
            file_hash="manual_" + str(data.field_id) + "_" + str(data.season),
            records_parsed=1,
            records_inserted=0,
            records_updated=0,
            records_skipped=0,
            status="failed",
            error_details=str(e),
            ingestion_started_at=datetime.utcnow(),
            ingestion_completed_at=datetime.utcnow()
        )
        db.add(ingestion_log)
        db.commit()
        
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to submit field data: {str(e)}"
        )


@router.get("/manual-entry/schema", summary="Get manual entry form schema")
async def get_manual_entry_schema():
    """
    Return the schema and validation rules for manual data entry.
    This can be used by frontend to build dynamic forms.
    """
    return {
        "required_fields": [
            "field_id", "crop_name_en", "acres", "grower", "season", 
            "job_id", "start", "end", "type", "status"
        ],
        "numeric_fields": [
            "field_id", "acres", "grower", "job_id", "lat", "long",
            "yield_bu_ac", "yield_target", "totalN_per_ac", "totalP_per_ac", 
            "totalK_per_ac", "water_applied_mm"
        ],
        "categorical_fields": {
            "crop_name_en": ["Wheat, Hard Winter", "Corn", "Sorghum", "Fallow", "Other"],
            "state": ["Kansas", "Nebraska", "Oklahoma", "Texas", "Colorado", "Other"],
            "irrigation_method": ["None", "Center Pivot", "Drip", "Flood", "Sprinkler", "Other"],
            "machine_type": ["Tractor", "Combine", "Planter", "Sprayer", "Harvester", "Other"],
            "type": ["Planting/Seeding", "Fertilizing", "Spraying", "Irrigation", "Harvesting", "Other"],
            "status": ["Completed", "In Progress", "Failed", "Cancelled"]
        },
        "date_fields": ["start", "end"],
        "validation_rules": {
            "field_id": {"min": 1, "type": "integer"},
            "acres": {"min": 0.1, "type": "float", "decimal_places": 2},
            "lat": {"min": -90, "max": 90, "type": "float", "decimal_places": 6},
            "long": {"min": -180, "max": 180, "type": "float", "decimal_places": 6},
            "yield_bu_ac": {"min": 0, "type": "float", "decimal_places": 1}
        }
    }
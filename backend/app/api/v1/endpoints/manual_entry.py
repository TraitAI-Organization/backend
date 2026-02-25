"""
Manual Data Entry endpoints - Form-based data submission
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional, Dict, Any
from datetime import datetime
import json
from uuid import uuid4
from app.database.session import get_db
from app.database import models
from app.database.schemas import (
    ManualEntryCreate,
    ManualEntryResponse,
)
from app.services.ui_config import get_form_config

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
    started_at = datetime.utcnow()
    file_hash = (
        f"manual_{data.field_id}_{data.season}_{data.job_id}_"
        f"{int(started_at.timestamp() * 1_000_000)}_{uuid4().hex[:8]}"
    )
    source_filename = data.filenames or "manual_entry"
    records_inserted = 0
    records_updated = 0

    try:
        # Field
        field = db.query(models.Field).filter(models.Field.field_id == data.field_id).first()
        if not field:
            field = models.Field(
                field_id=data.field_id,
                field_number=data.field_id,
                acres=data.acres,
                lat=data.lat,
                long=data.long,
                county=data.county,
                state=data.state,
                grower_id=data.grower,
            )
            db.add(field)
        else:
            # Keep field data fresh from manual updates.
            field.acres = data.acres or field.acres
            field.lat = data.lat if data.lat is not None else field.lat
            field.long = data.long if data.long is not None else field.long
            field.county = data.county or field.county
            field.state = data.state or field.state
            field.grower_id = data.grower or field.grower_id

        # Crop
        crop = (
            db.query(models.Crop)
            .filter(models.Crop.crop_name_en == data.crop_name_en)
            .first()
        )
        if not crop:
            crop = models.Crop(crop_name_en=data.crop_name_en, is_active=True)
            db.add(crop)
            db.flush()

        # Variety (optional)
        variety_id = None
        if data.variety_name_en:
            variety = (
                db.query(models.Variety)
                .filter(
                    models.Variety.variety_name_en == data.variety_name_en,
                    models.Variety.crop_id == crop.crop_id,
                )
                .first()
            )
            if not variety:
                variety = models.Variety(
                    variety_name_en=data.variety_name_en,
                    crop_id=crop.crop_id,
                    is_active=True,
                )
                db.add(variety)
                db.flush()
            variety_id = variety.variety_id

        # Season
        season = db.query(models.Season).filter(models.Season.season_year == data.season).first()
        if not season:
            season = models.Season(season_year=data.season, is_current=False)
            db.add(season)
            db.flush()

        # FieldSeason
        field_season = (
            db.query(models.FieldSeason)
            .filter(
                models.FieldSeason.field_id == data.field_id,
                models.FieldSeason.crop_id == crop.crop_id,
                models.FieldSeason.variety_id == variety_id,
                models.FieldSeason.season_id == season.season_id,
            )
            .first()
        )
        if not field_season:
            field_season = models.FieldSeason(
                field_id=data.field_id,
                crop_id=crop.crop_id,
                variety_id=variety_id,
                season_id=season.season_id,
                yield_bu_ac=data.yield_bu_ac,
                yield_target=data.yield_target,
                totalN_per_ac=data.totalN_per_ac,
                totalP_per_ac=data.totalP_per_ac,
                totalK_per_ac=data.totalK_per_ac,
                record_source="manual_entry",
                data_quality_score=1.0,
            )
            db.add(field_season)
            db.flush()
            records_inserted = 1
        else:
            # Update available fields without clearing existing values.
            if data.yield_bu_ac is not None:
                field_season.yield_bu_ac = data.yield_bu_ac
            if data.yield_target is not None:
                field_season.yield_target = data.yield_target
            if data.totalN_per_ac is not None:
                field_season.totalN_per_ac = data.totalN_per_ac
            if data.totalP_per_ac is not None:
                field_season.totalP_per_ac = data.totalP_per_ac
            if data.totalK_per_ac is not None:
                field_season.totalK_per_ac = data.totalK_per_ac
            field_season.record_source = "manual_entry"
            records_updated = 1

        # Optional management event for this manual submission.
        event_type = (data.type or "").strip()
        if event_type:
            actives_payload = None
            if data.actives:
                try:
                    actives_payload = json.loads(data.actives)
                except Exception:
                    actives_payload = data.actives
            event = models.ManagementEvent(
                field_season_id=field_season.field_season_id,
                job_id=data.job_id,
                event_type=event_type,
                status=data.status,
                start_date=data.start,
                end_date=data.end,
                application_area=data.application_area,
                amount=data.amount,
                description=data.description,
                fert_units=data.fert_units,
                rate=data.rate,
                blend_name=data.blend_name,
                chemical_type=data.chemical_type,
                chem_product=data.chem_product,
                chem_units=data.chem_units,
                actives=actives_payload,
                water_applied_mm=data.water_applied_mm,
                irrigation_method=data.irrigation_method,
                machine_make1=data.machine_make1,
                machine_model1=data.machine_model1,
                machine_type1=data.machine_type1,
                implement_a_make1=data.implement_a_make1,
                implement_a_model1=data.implement_a_model1,
                implement_a_type1=data.implement_a_type1,
                implement_b_make1=data.implement_b_make1,
                implement_b_model1=data.implement_b_model1,
                implement_b_type1=data.implement_b_type1,
                machine_make2=data.machine_make2,
                machine_model2=data.machine_model2,
                machine_type2=data.machine_type2,
                implement_a_make2=data.implement_a_make2,
                implement_a_model2=data.implement_a_model2,
                implement_a_type2=data.implement_a_type2,
                implement_b_make2=data.implement_b_make2,
                implement_b_model2=data.implement_b_model2,
                implement_b_type2=data.implement_b_type2,
                scout_count=data.scout_count,
                actives_id=data.actives_id,
                actives_Name=data.actives_Name,
                actives_Weight=data.actives_Weight,
                actives_Percent=data.actives_Percent,
                actives_subComponents=data.actives_subComponents,
            )
            db.add(event)

        db.commit()

        ingestion_log = models.DataIngestionLog(
            source_filename=source_filename,
            file_hash=file_hash,
            records_parsed=1,
            records_inserted=records_inserted,
            records_updated=records_updated,
            records_skipped=0,
            status="completed",
            error_details=None,
            ingestion_started_at=started_at,
            ingestion_completed_at=datetime.utcnow(),
        )
        db.add(ingestion_log)
        db.commit()

        return {
            "success": True,
            "message": "Field data submitted successfully",
            "field_season_id": field_season.field_season_id,
            "field_id": data.field_id,
            "season": data.season,
            "crop": data.crop_name_en,
            "status": "completed",
        }

    except Exception as e:
        db.rollback()
        try:
            ingestion_log = models.DataIngestionLog(
                source_filename=source_filename,
                file_hash=f"{file_hash}_failed",
                records_parsed=1,
                records_inserted=0,
                records_updated=0,
                records_skipped=0,
                status="failed",
                error_details=str(e),
                ingestion_started_at=started_at,
                ingestion_completed_at=datetime.utcnow(),
            )
            db.add(ingestion_log)
            db.commit()
        except IntegrityError:
            db.rollback()
        except Exception:
            db.rollback()

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
    base_schema = {
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
        },
        "custom_fields": [],
    }

    dynamic_cfg = get_form_config("manual_entry")
    dropdowns = dynamic_cfg.get("dropdowns", {})
    custom_fields = dynamic_cfg.get("custom_fields", [])

    for key, values in dropdowns.items():
        if isinstance(values, list):
            base_schema["categorical_fields"][key] = values
    base_schema["custom_fields"] = custom_fields

    return base_schema

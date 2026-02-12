"""
CRUD operations for database models
"""
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, asc, text
from typing import List, Optional, Dict, Any
import hashlib
import json

from . import models, schemas


# ==================== Fields ====================

def get_field(db: Session, field_id: int) -> Optional[models.Field]:
    return db.query(models.Field).filter(models.Field.field_id == field_id).first()


def get_field_by_number(db: Session, field_number: int) -> Optional[models.Field]:
    return db.query(models.Field).filter(models.Field.field_number == field_number).first()


def get_fields(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    state: Optional[str] = None,
    county: Optional[str] = None,
    min_acres: Optional[float] = None,
    max_acres: Optional[float] = None,
) -> List[models.Field]:
    query = db.query(models.Field)

    if state:
        query = query.filter(models.Field.state == state)
    if county:
        query = query.filter(models.Field.county == county)
    if min_acres is not None:
        query = query.filter(models.Field.acres >= min_acres)
    if max_acres is not None:
        query = query.filter(models.Field.acres <= max_acres)

    return query.offset(skip).limit(limit).all()


def create_field(db: Session, field: schemas.FieldCreate) -> models.Field:
    db_field = models.Field(**field.model_dump())
    db.add(db_field)
    db.commit()
    db.refresh(db_field)
    return db_field


def update_field(db: Session, field_id: int, field_update: schemas.FieldUpdate) -> Optional[models.Field]:
    db_field = get_field(db, field_id)
    if not db_field:
        return None

    update_data = field_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_field, key, value)

    db.commit()
    db.refresh(db_field)
    return db_field


# ==================== Crops ====================

def get_crop(db: Session, crop_id: int) -> Optional[models.Crop]:
    return db.query(models.Crop).filter(models.Crop.crop_id == crop_id).first()


def get_crop_by_name(db: Session, crop_name: str) -> Optional[models.Crop]:
    return db.query(models.Crop).filter(models.Crop.crop_name_en.ilike(crop_name)).first()


def get_crops(db: Session, active_only: bool = True) -> List[models.Crop]:
    query = db.query(models.Crop)
    if active_only:
        query = query.filter(models.Crop.is_active == True)
    return query.all()


def create_crop(db: Session, crop: schemas.CropCreate) -> models.Crop:
    db_crop = models.Crop(**crop.model_dump())
    db.add(db_crop)
    db.commit()
    db.refresh(db_crop)
    return db_crop


# ==================== Varieties ====================

def get_variety(db: Session, variety_id: int) -> Optional[models.Variety]:
    return db.query(models.Variety).filter(models.Variety.variety_id == variety_id).first()


def get_varieties_by_crop(db: Session, crop_id: int, active_only: bool = True) -> List[models.Variety]:
    query = db.query(models.Variety).filter(models.Variety.crop_id == crop_id)
    if active_only:
        query = query.filter(models.Variety.is_active == True)
    return query.all()


def get_variety_by_name_and_crop(db: Session, variety_name: str, crop_id: int) -> Optional[models.Variety]:
    return db.query(models.Variety).filter(
        models.Variety.variety_name_en.ilike(variety_name),
        models.Variety.crop_id == crop_id
    ).first()


def create_variety(db: Session, variety: schemas.VarietyCreate) -> models.Variety:
    db_variety = models.Variety(**variety.model_dump())
    db.add(db_variety)
    db.commit()
    db.refresh(db_variety)
    return db_variety


# ==================== Seasons ====================

def get_season(db: Session, season_id: int) -> Optional[models.Season]:
    return db.query(models.Season).filter(models.Season.season_id == season_id).first()


def get_season_by_year(db: Session, year: int) -> Optional[models.Season]:
    return db.query(models.Season).filter(models.Season.season_year == year).first()


def get_seasons(db: Session) -> List[models.Season]:
    return db.query(models.Season).order_by(desc(models.Season.season_year)).all()


def create_season(db: Session, season: schemas.SeasonCreate) -> models.Season:
    db_season = models.Season(**season.model_dump())
    db.add(db_season)
    db.commit()
    db.refresh(db_season)
    return db_season


# ==================== FieldSeasons ====================

def get_field_season(db: Session, field_season_id: int) -> Optional[models.FieldSeason]:
    return db.query(models.FieldSeason).filter(models.FieldSeason.field_season_id == field_season_id).first()


def get_field_seasons(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    crop: Optional[str] = None,
    variety: Optional[str] = None,
    season: Optional[List[int]] = None,
    state: Optional[str] = None,
    county: Optional[str] = None,
    min_acres: Optional[float] = None,
    max_acres: Optional[float] = None,
    has_prediction: Optional[bool] = None,
    min_yield: Optional[float] = None,
    max_yield: Optional[float] = None,
) -> List[models.FieldSeason]:
    query = db.query(models.FieldSeason).join(models.Field)

    # Always join Season for ordering
    query = query.join(models.Season)

    # Apply filters
    if crop:
        query = query.join(models.Crop).filter(models.Crop.crop_name_en.ilike(crop))
    if variety:
        query = query.join(models.Variety).filter(models.Variety.variety_name_en.ilike(variety))
    if season:
        query = query.filter(models.Season.season_year.in_(season))
    if state:
        query = query.filter(models.Field.state == state)
    if county:
        query = query.filter(models.Field.county == county)
    if min_acres is not None:
        query = query.filter(models.Field.acres >= min_acres)
    if max_acres is not None:
        query = query.filter(models.Field.acres <= max_acres)
    if has_prediction is True:
        query = query.join(models.ModelPrediction, isouter=True).filter(models.ModelPrediction.prediction_id != None)
    elif has_prediction is False:
        query = query.outerjoin(models.ModelPrediction).filter(models.ModelPrediction.prediction_id == None)
    if min_yield is not None and has_prediction:
        query = query.join(models.ModelPrediction).filter(models.ModelPrediction.predicted_yield >= min_yield)
    if max_yield is not None and has_prediction:
        query = query.join(models.ModelPrediction).filter(models.ModelPrediction.predicted_yield <= max_yield)

    # Add count of management events
    query = query.outerjoin(models.ManagementEvent).group_by(
        models.FieldSeason.field_season_id,
        models.Season.season_year,
        models.Field.field_number
    )

    # Order by most recent season first
    query = query.order_by(desc(models.Season.season_year), models.Field.field_number)

    return query.offset(skip).limit(limit).all()


def count_field_seasons(
    db: Session,
    crop: Optional[str] = None,
    variety: Optional[str] = None,
    season: Optional[List[int]] = None,
    state: Optional[str] = None,
    county: Optional[str] = None,
    min_acres: Optional[float] = None,
    max_acres: Optional[float] = None,
    has_prediction: Optional[bool] = None,
) -> int:
    query = db.query(func.count(models.FieldSeason.field_season_id)).join(models.Field)

    if crop:
        query = query.join(models.Crop).filter(models.Crop.crop_name_en.ilike(crop))
    if variety:
        query = query.join(models.Variety).filter(models.Variety.variety_name_en.ilike(variety))
    if season:
        query = query.join(models.Season).filter(models.Season.season_year.in_(season))
    if state:
        query = query.filter(models.Field.state == state)
    if county:
        query = query.filter(models.Field.county == county)
    if min_acres is not None:
        query = query.filter(models.Field.acres >= min_acres)
    if max_acres is not None:
        query = query.filter(models.Field.acres <= max_acres)
    if has_prediction is True:
        query = query.join(models.ModelPrediction, isouter=True).filter(models.ModelPrediction.prediction_id != None)
    elif has_prediction is False:
        query = query.outerjoin(models.ModelPrediction).filter(models.ModelPrediction.prediction_id == None)

    return query.scalar()


def get_field_season_with_details(
    db: Session, field_season_id: int
) -> Optional[models.FieldSeason]:
    from sqlalchemy.orm import joinedload
    return (
        db.query(models.FieldSeason)
        .options(
            joinedload(models.FieldSeason.field),
            joinedload(models.FieldSeason.crop),
            joinedload(models.FieldSeason.variety),
            joinedload(models.FieldSeason.season),
            joinedload(models.FieldSeason.management_events),
            joinedload(models.FieldSeason.predictions),
        )
        .filter(models.FieldSeason.field_season_id == field_season_id)
        .first()
    )


def create_field_season(db: Session, fs: schemas.FieldSeasonCreate) -> models.FieldSeason:
    db_fs = models.FieldSeason(**fs.model_dump())
    db.add(db_fs)
    db.commit()
    db.refresh(db_fs)
    return db_fs


def update_field_season(
    db: Session, field_season_id: int, fs_update: schemas.FieldSeasonUpdate
) -> Optional[models.FieldSeason]:
    db_fs = get_field_season(db, field_season_id)
    if not db_fs:
        return None

    update_data = fs_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_fs, key, value)

    db.commit()
    db.refresh(db_fs)
    return db_fs


# ==================== Management Events ====================

def get_management_event(db: Session, event_id: int) -> Optional[models.ManagementEvent]:
    return db.query(models.ManagementEvent).filter(models.ManagementEvent.event_id == event_id).first()


def get_management_events_by_field_season(
    db: Session, field_season_id: int
) -> List[models.ManagementEvent]:
    return (
        db.query(models.ManagementEvent)
        .filter(models.ManagementEvent.field_season_id == field_season_id)
        .order_by(models.ManagementEvent.start_date)
        .all()
    )


def create_management_event(
    db: Session, event: schemas.ManagementEventCreate
) -> models.ManagementEvent:
    db_event = models.ManagementEvent(**event.model_dump())
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event


# ==================== Ingestion Log ====================

def compute_file_hash(filepath: str) -> str:
    """Compute SHA256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def get_ingestion_by_hash(db: Session, file_hash: str) -> Optional[models.DataIngestionLog]:
    return (
        db.query(models.DataIngestionLog)
        .filter(models.DataIngestionLog.file_hash == file_hash)
        .first()
    )


def create_ingestion_log(
    db: Session, log: schemas.IngestionLogCreate
) -> models.DataIngestionLog:
    db_log = models.DataIngestionLog(**log.model_dump())
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log


def update_ingestion_log(
    db: Session, ingestion_id: int, **kwargs
) -> Optional[models.DataIngestionLog]:
    db_log = db.query(models.DataIngestionLog).filter(
        models.DataIngestionLog.ingestion_id == ingestion_id
    ).first()
    if not db_log:
        return None

    for key, value in kwargs.items():
        setattr(db_log, key, value)

    db.commit()
    db.refresh(db_log)
    return db_log


# ==================== Model Versions & Predictions ====================

def get_model_version(db: Session, model_version_id: int) -> Optional[models.ModelVersion]:
    return (
        db.query(models.ModelVersion)
        .filter(models.ModelVersion.model_version_id == model_version_id)
        .first()
    )


def get_production_model_version(db: Session) -> Optional[models.ModelVersion]:
    return (
        db.query(models.ModelVersion)
        .filter(models.ModelVersion.is_production == True)
        .order_by(desc(models.ModelVersion.training_date))
        .first()
    )


def get_model_versions(
    db: Session, skip: int = 0, limit: int = 100, active_only: bool = False
) -> List[models.ModelVersion]:
    query = db.query(models.ModelVersion).order_by(desc(models.ModelVersion.training_date))
    if active_only:
        # Get the latest version per model_type
        subq = (
            db.query(
                models.ModelVersion.model_type,
                func.max(models.ModelVersion.training_date).label("max_date"),
            )
            .group_by(models.ModelVersion.model_type)
            .subquery()
        )
        query = query.join(
            subq,
            (models.ModelVersion.model_type == subq.c.model_type)
            & (models.ModelVersion.training_date == subq.c.max_date),
        )
    return query.offset(skip).limit(limit).all()


def create_model_version(
    db: Session, mv: schemas.ModelVersionCreate
) -> models.ModelVersion:
    db_mv = models.ModelVersion(**mv.model_dump())
    db.add(db_mv)
    db.commit()
    db.refresh(db_mv)
    return db_mv


def set_production_model(db: Session, model_version_id: int) -> Optional[models.ModelVersion]:
    """
    Set a model version as production. Unsets any current production model.
    """
    # Unset current production
    db.query(models.ModelVersion).filter(models.ModelVersion.is_production == True).update(
        {"is_production": False}
    )

    # Set new production
    db_mv = get_model_version(db, model_version_id)
    if db_mv:
        db_mv.is_production = True
        db.commit()
        db.refresh(db_mv)

    return db_mv


def create_prediction(
    db: Session, prediction: schemas.ModelPredictionCreate
) -> models.ModelPrediction:
    db_pred = models.ModelPrediction(**prediction.model_dump())
    db.add(db_pred)
    db.commit()
    db.refresh(db_pred)
    return db_pred


def get_predictions_by_field_season(
    db: Session, field_season_id: int
) -> List[models.ModelPrediction]:
    return (
        db.query(models.ModelPrediction)
        .filter(models.ModelPrediction.field_season_id == field_season_id)
        .order_by(desc(models.ModelPrediction.created_at))
        .all()
    )


def get_latest_prediction_for_field_season(
    db: Session, field_season_id: int
) -> Optional[models.ModelPrediction]:
    return (
        db.query(models.ModelPrediction)
        .filter(models.ModelPrediction.field_season_id == field_season_id)
        .order_by(desc(models.ModelPrediction.created_at))
        .first()
    )


# ==================== Regional Stats ====================

def get_regional_yield_stats(
    db: Session,
    crop: str,
    season: int,
    state: str,
    county: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get yield statistics by county for a given crop/season/state.
    Returns list of dicts with county, avg_yield, std, sample_size.
    """
    query = db.query(
        models.Field.county,
        func.avg(models.FieldSeason.yield_bu_ac).label("avg_yield"),
        func.stddev(models.FieldSeason.yield_bu_ac).label("std_yield"),
        func.count(models.FieldSeason.field_season_id).label("sample_size"),
    ).join(
        models.Field, models.FieldSeason.field_id == models.Field.field_id
    ).join(
        models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
    ).join(
        models.Season, models.FieldSeason.season_id == models.Season.season_id
    ).filter(
        models.Crop.crop_name_en.ilike(crop),
        models.Season.season_year == season,
        models.Field.state == state,
        models.FieldSeason.yield_bu_ac.isnot(None),
    ).group_by(models.Field.county)

    if county:
        query = query.filter(models.Field.county.ilike(county))

    results = query.order_by(desc("avg_yield")).all()

    return [
        {
            "county": r.county,
            "avg_yield": float(r.avg_yield) if r.avg_yield else None,
            "std": float(r.std_yield) if r.std_yield else None,
            "sample_size": r.sample_size,
        }
        for r in results
    ]


def get_variety_comparison(
    db: Session, crop: str, season: int
) -> List[Dict[str, Any]]:
    """
    Get variety-level statistics.
    """
    query = db.query(
        models.Variety.variety_name_en,
        func.avg(models.FieldSeason.yield_bu_ac).label("mean_observed_yield"),
        func.count(models.FieldSeason.field_season_id).label("n"),
    ).join(
        models.FieldSeason, models.FieldSeason.variety_id == models.Variety.variety_id
    ).join(
        models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
    ).join(
        models.Season, models.FieldSeason.season_id == models.Season.season_id
    ).filter(
        models.Crop.crop_name_en.ilike(crop),
        models.Season.season_year == season,
        models.FieldSeason.yield_bu_ac.isnot(None),
    ).group_by(models.Variety.variety_name_en)

    results = query.order_by(desc("mean_observed_yield")).all()

    return [
        {
            "variety": r.variety_name_en,
            "mean_observed_yield": float(r.mean_observed_yield) if r.mean_observed_yield else None,
            "n": r.n,
        }
        for r in results
    ]


# ==================== Overview ====================

def get_overview_stats(db: Session) -> Dict[str, Any]:
    """
    Get overall statistics for the dashboard.
    """
    total_fields = db.query(func.count(models.Field.field_id)).scalar()
    total_field_seasons = db.query(func.count(models.FieldSeason.field_season_id)).scalar()

    seasons = (
        db.query(models.Season.season_year)
        .join(models.FieldSeason)
        .distinct()
        .order_by(desc(models.Season.season_year))
        .all()
    )
    seasons_available = [s[0] for s in seasons]

    crops = (
        db.query(
            models.Crop.crop_name_en,
            func.count(models.FieldSeason.field_season_id).label("count"),
        )
        .join(models.FieldSeason)
        .group_by(models.Crop.crop_name_en)
        .order_by(desc("count"))
        .all()
    )
    crops_available = [{"crop_name": c[0], "count": c[1]} for c in crops]

    states = (
        db.query(models.Field.state)
        .join(models.FieldSeason)
        .distinct()
        .order_by(models.Field.state)
        .all()
    )
    states_available = [s[0] for s in states if s[0]]

    yield_range = db.query(
        func.min(models.FieldSeason.yield_bu_ac),
        func.max(models.FieldSeason.yield_bu_ac),
        func.avg(models.FieldSeason.yield_bu_ac),
    ).filter(models.FieldSeason.yield_bu_ac.isnot(None)).first()

    # Prediction statistics (from stored model predictions)
    field_seasons_with_predictions = (
        db.query(func.count(func.distinct(models.ModelPrediction.field_season_id)))
        .scalar() or 0
    )
    total_predictions = db.query(func.count(models.ModelPrediction.prediction_id)).scalar() or 0
    pred_range = (
        db.query(
            func.min(models.ModelPrediction.predicted_yield),
            func.max(models.ModelPrediction.predicted_yield),
            func.avg(models.ModelPrediction.predicted_yield),
        )
        .first()
    )
    prediction_stats = {
        "field_seasons_with_predictions": field_seasons_with_predictions,
        "total_predictions": total_predictions,
        "predicted_yield_min": float(pred_range[0]) if pred_range and pred_range[0] is not None else 0.0,
        "predicted_yield_max": float(pred_range[1]) if pred_range and pred_range[1] is not None else 0.0,
        "predicted_yield_avg": float(pred_range[2]) if pred_range and pred_range[2] is not None else 0.0,
    }

    return {
        "total_field_seasons": total_field_seasons or 0,
        "total_fields": total_fields or 0,
        "seasons_available": seasons_available,
        "crops_available": crops_available,
        "states_available": states_available,
        "yield_range": {
            "min": float(yield_range[0]) if yield_range[0] else 0.0,
            "max": float(yield_range[1]) if yield_range[1] else 0.0,
            "avg": float(yield_range[2]) if yield_range[2] else 0.0,
        },
        "prediction_stats": prediction_stats,
    }
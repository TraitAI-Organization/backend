"""
SQLAlchemy database models
"""
from sqlalchemy import (
    Column, Integer, BigInteger, String, DECIMAL, Boolean, DateTime,
    ForeignKey, Text, JSON, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from typing import Optional

from .session import Base


class Field(Base):
    """
    Master list of unique fields.
    """
    __tablename__ = "fields"

    field_id = Column(BigInteger, primary_key=True, index=True)
    field_number = Column(BigInteger, unique=True, nullable=False, index=True)
    acres = Column(DECIMAL(10, 2))
    lat = Column(DECIMAL(9, 6))
    long = Column(DECIMAL(9, 6))
    county = Column(String(100), index=True)
    state = Column(String(50), index=True)
    grower_id = Column(Integer, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    field_seasons = relationship("FieldSeason", back_populates="field")


class Crop(Base):
    """
    Lookup table for crops.
    """
    __tablename__ = "crops"

    crop_id = Column(Integer, primary_key=True, index=True)
    crop_name_en = Column(String(100), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)

    # Relationships
    varieties = relationship("Variety", back_populates="crop")
    field_seasons = relationship("FieldSeason", back_populates="crop")


class Variety(Base):
    """
    Lookup table for varieties, linked to crops.
    """
    __tablename__ = "varieties"

    variety_id = Column(Integer, primary_key=True, index=True)
    variety_name_en = Column(String(200), index=True)
    crop_id = Column(Integer, ForeignKey("crops.crop_id"), nullable=False, index=True)
    is_active = Column(Boolean, default=True)

    # Relationships
    crop = relationship("Crop", back_populates="varieties")
    field_seasons = relationship("FieldSeason", back_populates="variety")

    __table_args__ = (
        UniqueConstraint('variety_name_en', 'crop_id', name='uq_variety_crop'),
    )


class Season(Base):
    """
    Lookup table for growing seasons/years.
    """
    __tablename__ = "seasons"

    season_id = Column(Integer, primary_key=True, index=True)
    season_year = Column(Integer, unique=True, nullable=False, index=True)
    is_current = Column(Boolean, default=False)

    # Relationships
    field_seasons = relationship("FieldSeason", back_populates="season")


class FieldSeason(Base):
    """
    Main fact table: one record per field per season per crop/variety.
    Contains observed yields and aggregated nutrient totals.
    """
    __tablename__ = "field_seasons"

    field_season_id = Column(BigInteger, primary_key=True, index=True)

    # Foreign keys
    field_id = Column(BigInteger, ForeignKey("fields.field_id"), nullable=False, index=True)
    crop_id = Column(Integer, ForeignKey("crops.crop_id"), nullable=False, index=True)
    variety_id = Column(Integer, ForeignKey("varieties.variety_id"), index=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False, index=True)

    # Observed yields (if available)
    yield_bu_ac = Column(DECIMAL(6, 2))
    yield_target = Column(DECIMAL(6, 2))

    # Calculated nutrient totals (from aggregated operations)
    totalN_per_ac = Column(DECIMAL(6, 3))
    totalP_per_ac = Column(DECIMAL(6, 3))
    totalK_per_ac = Column(DECIMAL(6, 3))

    # Metadata
    record_source = Column(String(200))
    data_quality_score = Column(DECIMAL(3, 2), default=1.0)
    missing_data_flags = Column(JSON)  # e.g., {"yield": false, "fertilizer": true}

    # Relationships
    field = relationship("Field", back_populates="field_seasons")
    crop = relationship("Crop", back_populates="field_seasons")
    variety = relationship("Variety", back_populates="field_seasons")
    season = relationship("Season", back_populates="field_seasons")
    management_events = relationship("ManagementEvent", back_populates="field_season", cascade="all, delete-orphan")
    predictions = relationship("ModelPrediction", back_populates="field_season")

    __table_args__ = (
        UniqueConstraint('field_id', 'crop_id', 'variety_id', 'season_id', name='uq_field_season'),
        Index('idx_field_seasons_yield', 'yield_bu_ac'),
    )


class ManagementEvent(Base):
    """
    All management operations: planting, fertilizer applications, sprays, harvest, etc.
    """
    __tablename__ = "management_events"

    event_id = Column(BigInteger, primary_key=True, index=True)

    # Foreign key
    field_season_id = Column(BigInteger, ForeignKey("field_seasons.field_season_id"), nullable=False, index=True)

    # Event details
    job_id = Column(BigInteger, index=True)
    event_type = Column(String(50), index=True)  # 'Planting/Seeding', 'Spraying', 'Tillage', 'Harvesting', etc.
    status = Column(String(50))

    # Timing
    start_date = Column(DateTime(timezone=True), index=True)
    end_date = Column(DateTime(timezone=True))

    # Application details
    application_area = Column(DECIMAL(10, 2))  # acres
    amount = Column(DECIMAL(12, 4))
    description = Column(Text)
    fert_units = Column(String(50))
    rate = Column(DECIMAL(10, 4))

    # Fertilizer
    fertilizer_id = Column(Integer)
    blend_name = Column(String(200))

    # Chemical
    chemical_type = Column(String(50))
    chem_product = Column(String(200))
    chem_units = Column(String(50))

    # Active ingredients (JSON array of objects)
    actives = Column(JSON)  # [{"id": 13, "Name": "Acetochlor", "Weight": 2.7, "Percent": 29.0}]

    # Irrigation
    water_applied_mm = Column(DECIMAL(6, 2))
    irrigation_method = Column(String(100))

    # Equipment
    machine_make1 = Column(String(100))
    machine_model1 = Column(String(100))
    machine_type1 = Column(String(100))
    implement_a_make1 = Column(String(100))
    implement_a_model1 = Column(String(100))
    implement_a_type1 = Column(String(100))
    implement_b_make1 = Column(String(100))
    implement_b_model1 = Column(String(100))
    implement_b_type1 = Column(String(100))
    machine_make2 = Column(String(100))
    machine_model2 = Column(String(100))
    machine_type2 = Column(String(100))
    implement_a_make2 = Column(String(100))
    implement_a_model2 = Column(String(100))
    implement_a_type2 = Column(String(100))
    implement_b_make2 = Column(String(100))
    implement_b_model2 = Column(String(100))
    implement_b_type2 = Column(String(100))

    scout_count = Column(Integer)
    chem_product = Column(String(200))
    water_applied_mm = Column(DECIMAL(6, 2))
    irrigation_method = Column(String(100))
    actives_id = Column(JSON)
    actives_Name = Column(JSON)
    actives_Weight = Column(JSON)
    actives_Percent = Column(JSON)
    actives_subComponents = Column(JSON)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    field_season = relationship("FieldSeason", back_populates="management_events")

    __table_args__ = (
        Index('idx_management_events_field_season', 'field_season_id'),
        Index('idx_management_events_type', 'event_type'),
    )


class ModelVersion(Base):
    """
    ML model version registry with performance metrics.
    """
    __tablename__ = "model_versions"

    model_version_id = Column(Integer, primary_key=True, index=True)
    version_tag = Column(String(50), unique=True, nullable=False, index=True)

    model_type = Column(String(50), nullable=False)  # 'xgboost', 'lightgbm', 'random_forest', 'neural_net'
    model_params = Column(JSON, nullable=False)  # hyperparameters

    training_data_range = Column(JSON)  # {"start_season": 2018, "end_season": 2024, "record_count": 15000}
    performance_metrics = Column(JSON, nullable=False)  # {"rmse": 12.5, "r2": 0.78, "mae": 9.2}

    training_date = Column(DateTime(timezone=True), server_default=func.now())
    is_production = Column(Boolean, default=False)

    feature_list = Column(JSON, nullable=False)  # List of feature names
    preprocessing_steps = Column(JSON)  # imputation, scaling, encoding details

    notes = Column(Text)
    created_by = Column(String(100))

    # Relationships
    predictions = relationship("ModelPrediction", back_populates="model_version")
    training_runs = relationship("TrainingRun", back_populates="model_version")


class ModelPrediction(Base):
    """
    Predictions made by models for field-season records.
    """
    __tablename__ = "model_predictions"

    prediction_id = Column(BigInteger, primary_key=True, index=True)

    # Foreign keys
    field_season_id = Column(BigInteger, ForeignKey("field_seasons.field_season_id"), nullable=False, index=True)
    model_version_id = Column(Integer, ForeignKey("model_versions.model_version_id"), index=True)

    # Prediction results
    predicted_yield = Column(DECIMAL(6, 2))
    confidence_lower = Column(DECIMAL(6, 2))
    confidence_upper = Column(DECIMAL(6, 2))

    # Feature importance for this prediction
    feature_contributions = Column(JSON)  # [{"feature": "totalN_per_ac", "value": 0.35, "direction": "positive"}]

    # Regional comparison
    regional_avg_yield = Column(DECIMAL(6, 2))
    regional_std_yield = Column(DECIMAL(6, 2))

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    field_season = relationship("FieldSeason", back_populates="predictions")
    model_version = relationship("ModelVersion", back_populates="predictions")

    __table_args__ = (
        UniqueConstraint('field_season_id', 'model_version_id', name='uq_prediction_field_model'),
        Index('idx_model_predictions_field_season', 'field_season_id'),
        Index('idx_model_predictions_model', 'model_version_id'),
    )


class TrainingRun(Base):
    """
    Tracking for model training runs (MLOps).
    """
    __tablename__ = "training_runs"

    run_id = Column(BigInteger, primary_key=True, index=True)

    # Foreign key
    model_version_id = Column(Integer, ForeignKey("model_versions.model_version_id"), index=True)

    git_commit_hash = Column(String(40))
    training_script_path = Column(String(500))

    dataset_hash = Column(String(64))  # SHA256 of training data snapshot
    training_duration_seconds = Column(Integer)
    training_records = Column(Integer)
    validation_records = Column(Integer)

    status = Column(String(50), default='completed')  # 'running', 'failed', 'completed'
    error_message = Column(Text)

    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))

    # Relationships
    model_version = relationship("ModelVersion", back_populates="training_runs")


class DataIngestionLog(Base):
    """
    Track CSV imports for data provenance.
    """
    __tablename__ = "data_ingestion_log"

    ingestion_id = Column(BigInteger, primary_key=True, index=True)
    source_filename = Column(String(500), nullable=False)
    file_hash = Column(String(64), unique=True, nullable=False, index=True)

    records_parsed = Column(Integer)
    records_inserted = Column(Integer)
    records_updated = Column(Integer)
    records_skipped = Column(Integer)

    ingestion_started_at = Column(DateTime(timezone=True), server_default=func.now())
    ingestion_completed_at = Column(DateTime(timezone=True))

    status = Column(String(50), default='processing')
    error_details = Column(JSON)


class ExportLog(Base):
    """
    Track data exports.
    """
    __tablename__ = "export_logs"

    export_id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(String(100))
    export_type = Column(String(50))  # 'csv_filtered', 'field_summary'
    filters_applied = Column(JSON)
    record_count = Column(Integer)
    file_size_bytes = Column(Integer)
    exported_at = Column(DateTime(timezone=True), server_default=func.now())
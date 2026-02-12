"""
Pydantic schemas for request/response validation
"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime, date


# Base schemas
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# Field schemas
class FieldBase(BaseSchema):
    field_number: int
    acres: Optional[float] = None
    lat: Optional[float] = None
    long: Optional[float] = None
    county: Optional[str] = None
    state: Optional[str] = None
    grower_id: Optional[int] = None


class FieldCreate(FieldBase):
    pass


class FieldUpdate(BaseSchema):
    acres: Optional[float] = None
    lat: Optional[float] = None
    long: Optional[float] = None
    county: Optional[str] = None
    state: Optional[str] = None
    grower_id: Optional[int] = None


class FieldResponse(FieldBase):
    field_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Crop schemas
class CropBase(BaseSchema):
    crop_name_en: str
    is_active: bool = True


class CropCreate(CropBase):
    pass


class CropResponse(CropBase):
    crop_id: int

    model_config = ConfigDict(from_attributes=True)


# Variety schemas
class VarietyBase(BaseSchema):
    variety_name_en: str
    crop_id: int
    is_active: bool = True


class VarietyCreate(VarietyBase):
    pass


class VarietyResponse(VarietyBase):
    variety_id: int

    model_config = ConfigDict(from_attributes=True)


# Season schemas
class SeasonBase(BaseSchema):
    season_year: int
    is_current: bool = False


class SeasonCreate(SeasonBase):
    pass


class SeasonResponse(SeasonBase):
    season_id: int

    model_config = ConfigDict(from_attributes=True)


# FieldSeason schemas
class FieldSeasonBase(BaseSchema):
    field_id: int
    crop_id: int
    variety_id: Optional[int] = None
    season_id: int
    yield_bu_ac: Optional[float] = None
    yield_target: Optional[float] = None
    totalN_per_ac: Optional[float] = None
    totalP_per_ac: Optional[float] = None
    totalK_per_ac: Optional[float] = None
    record_source: Optional[str] = None
    data_quality_score: float = 1.0
    missing_data_flags: Optional[Dict[str, Any]] = None


class FieldSeasonCreate(FieldSeasonBase):
    pass


class FieldSeasonUpdate(BaseSchema):
    yield_bu_ac: Optional[float] = None
    yield_target: Optional[float] = None
    totalN_per_ac: Optional[float] = None
    totalP_per_ac: Optional[float] = None
    totalK_per_ac: Optional[float] = None
    record_source: Optional[str] = None
    data_quality_score: Optional[float] = None
    missing_data_flags: Optional[Dict[str, Any]] = None


class FieldSeasonResponse(FieldSeasonBase):
    field_season_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FieldSeasonDetailResponse(FieldSeasonResponse):
    """
    Detailed response with joined data
    """
    field: Optional[FieldResponse] = None
    crop: Optional[CropResponse] = None
    variety: Optional[VarietyResponse] = None
    season: Optional[SeasonResponse] = None
    management_event_count: Optional[int] = None
    predictions: Optional[List[Dict[str, Any]]] = None


# ManagementEvent schemas
class ManagementEventBase(BaseSchema):
    field_season_id: int
    job_id: Optional[int] = None
    event_type: str
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    application_area: Optional[float] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    fert_units: Optional[str] = None
    rate: Optional[float] = None
    fertilizer_id: Optional[int] = None
    blend_name: Optional[str] = None
    chemical_type: Optional[str] = None
    chem_product: Optional[str] = None
    chem_units: Optional[str] = None
    actives: Optional[List[Dict[str, Any]]] = None
    water_applied_mm: Optional[float] = None
    irrigation_method: Optional[str] = None
    machine_make1: Optional[str] = None
    machine_model1: Optional[str] = None
    machine_type1: Optional[str] = None


class ManagementEventCreate(ManagementEventBase):
    pass


class ManagementEventResponse(ManagementEventBase):
    event_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Prediction schemas
class PredictionRequest(BaseSchema):
    """
    Request for yield prediction
    """
    crop: str
    variety: Optional[str] = None
    acres: float
    lat: float
    long: float
    season: int
    totalN_per_ac: float
    totalP_per_ac: float
    totalK_per_ac: float

    # Optional additional features
    water_applied_mm: Optional[float] = None
    event_count: Optional[int] = None
    county: Optional[str] = None
    state: Optional[str] = None


class FeatureContribution(BaseSchema):
    feature: str
    value: float
    direction: str  # "positive" or "negative"
    importance: float  # 0-1


class PredictionResponse(BaseSchema):
    predicted_yield: float
    confidence_interval: List[float]  # [lower, upper]
    model_version: str

    # Regional comparison
    regional_comparison: Optional[Dict[str, Any]] = None

    # Explainability
    explainability: Optional[Dict[str, List[FeatureContribution]]] = None

    # Recommendations (future)
    recommendations: Optional[Dict[str, Any]] = None


# Model version schemas
class ModelVersionBase(BaseSchema):
    model_config = ConfigDict(protected_namespaces=())
    version_tag: str
    model_type: str
    model_params: Dict[str, Any]
    training_data_range: Optional[Dict[str, Any]] = None
    performance_metrics: Dict[str, float]
    feature_list: List[str]
    preprocessing_steps: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None


class ModelVersionCreate(ModelVersionBase):
    pass


class ModelVersionResponse(ModelVersionBase):
    model_version_id: int
    training_date: datetime
    is_production: bool

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


class ModelVersionDetailResponse(ModelVersionResponse):
    training_runs: Optional[List[Dict[str, Any]]] = None


# Model prediction schemas
class ModelPredictionBase(BaseSchema):
    model_config = ConfigDict(protected_namespaces=())
    field_season_id: int
    model_version_id: Optional[int] = None
    predicted_yield: float
    confidence_lower: float
    confidence_upper: float
    feature_contributions: Optional[List[Dict[str, Any]]] = None
    regional_avg_yield: Optional[float] = None
    regional_std_yield: Optional[float] = None


class ModelPredictionCreate(ModelPredictionBase):
    pass


class ModelPredictionResponse(ModelPredictionBase):
    prediction_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


# Overview schemas
class OverviewResponse(BaseSchema):
    model_config = ConfigDict(protected_namespaces=())
    total_field_seasons: int
    seasons_available: List[int]
    crops_available: List[Dict[str, Any]]  # [{"crop_id": 1, "crop_name": "Sorghum", "count": 8000}]
    states_available: List[str]
    counties_available: Optional[List[str]] = None
    yield_range: Dict[str, float]  # {"min": 20.5, "max": 180.2, "avg": 89.4}
    model_versions: Optional[List[Dict[str, Any]]] = None
    prediction_stats: Optional[Dict[str, Any]] = None  # from stored predictions


# Export schemas
class ExportRequest(BaseSchema):
    crop: Optional[str] = None
    variety: Optional[str] = None
    season: Optional[List[int]] = None
    state: Optional[str] = None
    county: Optional[str] = None
    min_acres: Optional[float] = None
    max_acres: Optional[float] = None
    has_prediction: Optional[bool] = None
    min_yield: Optional[float] = None
    max_yield: Optional[float] = None


# Regional schemas
class RegionalAvgResponse(BaseSchema):
    crop: str
    season: int
    state: str
    county_averages: List[Dict[str, Any]]  # [{"county": "Ford", "avg_yield": 72.3, "std": 12.1, "sample_size": 145}]


class VarietyComparisonResponse(BaseSchema):
    crop: str
    season: int
    variety_stats: List[Dict[str, Any]]  # [{"variety": "Pioneer 86P20", "mean_predicted_yield": 75.2, "n": 45, "mean_observed_yield": 73.8}]


# Ingestion log schemas
class IngestionLogBase(BaseSchema):
    source_filename: str
    file_hash: str
    records_parsed: Optional[int] = None
    records_inserted: Optional[int] = None
    records_updated: Optional[int] = None
    records_skipped: Optional[int] = None
    status: str = "processing"
    error_details: Optional[Dict[str, Any]] = None


class IngestionLogCreate(IngestionLogBase):
    pass


class IngestionLogResponse(IngestionLogBase):
    ingestion_id: int
    ingestion_started_at: datetime
    ingestion_completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# Pagination
class PaginationParams(BaseSchema):
    page: int = Field(1, ge=1)
    limit: int = Field(50, ge=1, le=500)


class PaginatedResponse(BaseSchema):
    data: List[Any]
    total: int
    page: int
    limit: int
    pages: int


# Health check
class HealthResponse(BaseSchema):
    status: str
    database: str
    timestamp: datetime
    version: str


# Manual entry schemas
class ManualEntryCreate(BaseSchema):
    field_id: int
    crop_name_en: str
    variety_name_en: Optional[str] = None
    acres: float
    grower: int
    season: int
    job_id: int
    start: datetime
    end: datetime
    type: str = "Manual Entry"
    status: str = "Completed"
    application_area: Optional[float] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    fert_units: Optional[str] = None
    rate: Optional[float] = None
    supply_id: Optional[str] = None
    tankMix_id: Optional[str] = None
    fertilizer_id: Optional[str] = None
    blend_name: Optional[str] = None
    name: Optional[str] = None
    percent: Optional[float] = None
    n: Optional[float] = None
    p: Optional[float] = None
    k: Optional[float] = None
    usGallonsPerMT: Optional[float] = None
    formula: Optional[str] = None
    state: Optional[str] = None
    manure_type: Optional[str] = None
    chemical_type: Optional[str] = None
    cdms_fk: Optional[str] = None
    chem_units: Optional[str] = None
    yield_target: Optional[float] = None
    file_last_modified: Optional[datetime] = None
    filenames: Optional[str] = None
    machine_make1: Optional[str] = None
    machine_model1: Optional[str] = None
    machine_type1: Optional[str] = None
    implement_a_make1: Optional[str] = None
    implement_a_model1: Optional[str] = None
    implement_a_type1: Optional[str] = None
    implement_b_make1: Optional[str] = None
    implement_b_model1: Optional[str] = None
    implement_b_type1: Optional[str] = None
    machine_make2: Optional[str] = None
    machine_model2: Optional[str] = None
    machine_type2: Optional[str] = None
    implement_a_make2: Optional[str] = None
    implement_a_model2: Optional[str] = None
    implement_a_type2: Optional[str] = None
    implement_b_make2: Optional[str] = None
    implement_b_model2: Optional[str] = None
    implement_b_type2: Optional[str] = None
    scout_count: Optional[int] = None
    chem_product: Optional[str] = None
    water_applied_mm: Optional[float] = None
    irrigation_method: Optional[str] = None
    actives: Optional[str] = None
    totalN_per_ac: Optional[float] = None
    totalP_per_ac: Optional[float] = None
    totalK_per_ac: Optional[float] = None
    ammonia_lbN_per_ac: Optional[float] = None
    urea_lbN_per_ac: Optional[float] = None
    ammonium_nitrate_lbN_per_ac: Optional[float] = None
    ammonium_sulfate_lbN_per_ac: Optional[float] = None
    urea_ammonium_nitrate_solution_lbN_per_ac: Optional[float] = None
    monoammonium_phosphate_lbN_per_ac: Optional[float] = None
    diammonium_phosphate_lbN_per_ac: Optional[float] = None
    other_lbN_per_ac: Optional[float] = None
    monoammonium_phosphate_lbP_per_ac: Optional[float] = None
    diammonium_phosphate_lbP_per_ac: Optional[float] = None
    other_lbP_per_ac: Optional[float] = None
    potash_lbK_per_ac: Optional[float] = None
    other_lbK_per_ac: Optional[float] = None
    manure_lbN_per_ac: Optional[float] = None
    manure_lbP_per_ac: Optional[float] = None
    manure_lbK_per_ac: Optional[float] = None
    lime_per_ac: Optional[float] = None
    lat: Optional[float] = None
    long: Optional[float] = None
    yield_bu_ac: Optional[float] = None
    county: Optional[str] = None
    actives_id: Optional[str] = None
    actives_Name: Optional[str] = None
    actives_Weight: Optional[float] = None
    actives_Percent: Optional[float] = None
    actives_subComponents: Optional[str] = None


class ManualEntryResponse(BaseSchema):
    success: bool
    message: str
    field_season_id: Optional[int] = None
    field_id: Optional[int] = None
    season: Optional[int] = None
    crop: Optional[str] = None
    status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())
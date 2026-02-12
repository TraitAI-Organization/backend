-- Nutrition AI Database Schema
-- Full SQL definition for reference

-- Enable UUID extension if needed
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Fields Table
CREATE TABLE IF NOT EXISTS fields (
    field_id BIGSERIAL PRIMARY KEY,
    field_number BIGINT UNIQUE NOT NULL,
    acres DECIMAL(10,2),
    lat DECIMAL(9,6),
    long DECIMAL(9,6),
    county VARCHAR(100),
    state VARCHAR(50),
    grower_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fields_geo ON fields(lat, long);
CREATE INDEX IF NOT EXISTS idx_fields_state_county ON fields(state, county);

-- 2. Crops Table
CREATE TABLE IF NOT EXISTS crops (
    crop_id SERIAL PRIMARY KEY,
    crop_name_en VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- 3. Varieties Table
CREATE TABLE IF NOT EXISTS varieties (
    variety_id SERIAL PRIMARY KEY,
    variety_name_en VARCHAR(200),
    crop_id INTEGER REFERENCES crops(crop_id),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(variety_name_en, crop_id)
);
CREATE INDEX IF NOT EXISTS idx_varieties_crop ON varieties(crop_id);

-- 4. Seasons Table
CREATE TABLE IF NOT EXISTS seasons (
    season_id SERIAL PRIMARY KEY,
    season_year INTEGER UNIQUE NOT NULL,
    is_current BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_seasons_year ON seasons(season_year);

-- 5. Field-Seasons Table (Main Fact Table)
CREATE TABLE IF NOT EXISTS field_seasons (
    field_season_id BIGSERIAL PRIMARY KEY,
    field_id BIGINT REFERENCES fields(field_id),
    crop_id INTEGER REFERENCES crops(crop_id),
    variety_id INTEGER REFERENCES varieties(variety_id),
    season_id INTEGER REFERENCES seasons(season_id),
    yield_bu_ac DECIMAL(6,2),
    yield_target DECIMAL(6,2),
    totalN_per_ac DECIMAL(6,3),
    totalP_per_ac DECIMAL(6,3),
    totalK_per_ac DECIMAL(6,3),
    record_source VARCHAR(200),
    data_quality_score DECIMAL(3,2) DEFAULT 1.0,
    missing_data_flags JSONB,
    UNIQUE(field_id, crop_id, variety_id, season_id)
);
CREATE INDEX IF NOT EXISTS idx_field_seasons_field ON field_seasons(field_id);
CREATE INDEX IF NOT EXISTS idx_field_seasons_crop ON field_seasons(crop_id);
CREATE INDEX IF NOT EXISTS idx_field_seasons_season ON field_seasons(season_id);
CREATE INDEX IF NOT EXISTS idx_field_seasons_yield ON field_seasons(yield_bu_ac);

-- 6. Management Events Table
CREATE TABLE IF NOT EXISTS management_events (
    event_id BIGSERIAL PRIMARY KEY,
    field_season_id BIGINT REFERENCES field_seasons(field_season_id),
    job_id BIGINT,
    event_type VARCHAR(50),
    status VARCHAR(50),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    application_area DECIMAL(10,2),
    amount DECIMAL(12,4),
    description TEXT,
    fert_units VARCHAR(50),
    rate DECIMAL(10,4),
    fertilizer_id INTEGER,
    blend_name VARCHAR(200),
    chemical_type VARCHAR(50),
    chem_product VARCHAR(200),
    chem_units VARCHAR(50),
    actives JSONB,
    water_applied_mm DECIMAL(6,2),
    irrigation_method VARCHAR(100),
    machine_make1 VARCHAR(100),
    machine_model1 VARCHAR(100),
    machine_type1 VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_management_events_field_season ON management_events(field_season_id);
CREATE INDEX IF NOT EXISTS idx_management_events_type ON management_events(event_type);
CREATE INDEX IF NOT EXISTS idx_management_events_start ON management_events(start_date);

-- 7. Model Versions Table
CREATE TABLE IF NOT EXISTS model_versions (
    model_version_id SERIAL PRIMARY KEY,
    version_tag VARCHAR(50) UNIQUE NOT NULL,
    model_type VARCHAR(50) NOT NULL,
    model_params JSONB NOT NULL,
    training_data_range JSONB,
    performance_metrics JSONB NOT NULL,
    training_date TIMESTAMPTZ DEFAULT NOW(),
    is_production BOOLEAN DEFAULT FALSE,
    feature_list JSONB NOT NULL,
    preprocessing_steps JSONB,
    notes TEXT,
    created_by VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_model_versions_production ON model_versions(is_production) WHERE is_production = TRUE;
CREATE INDEX IF NOT EXISTS idx_model_versions_training_date ON model_versions(training_date DESC);

-- 8. Model Predictions Table
CREATE TABLE IF NOT EXISTS model_predictions (
    prediction_id BIGSERIAL PRIMARY KEY,
    field_season_id BIGINT REFERENCES field_seasons(field_season_id),
    model_version_id INTEGER REFERENCES model_versions(model_version_id),
    predicted_yield DECIMAL(6,2),
    confidence_lower DECIMAL(6,2),
    confidence_upper DECIMAL(6,2),
    feature_contributions JSONB,
    regional_avg_yield DECIMAL(6,2),
    regional_std_yield DECIMAL(6,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(field_season_id, model_version_id)
);
CREATE INDEX IF NOT EXISTS idx_model_predictions_field_season ON model_predictions(field_season_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_model ON model_predictions(model_version_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_created_at ON model_predictions(created_at DESC);

-- 9. Training Runs Table
CREATE TABLE IF NOT EXISTS training_runs (
    run_id BIGSERIAL PRIMARY KEY,
    model_version_id INTEGER REFERENCES model_versions(model_version_id),
    git_commit_hash VARCHAR(40),
    training_script_path VARCHAR(500),
    dataset_hash VARCHAR(64),
    training_duration_seconds INTEGER,
    training_records INTEGER,
    validation_records INTEGER,
    status VARCHAR(50) DEFAULT 'completed',
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_training_runs_model ON training_runs(model_version_id);
CREATE INDEX IF NOT EXISTS idx_training_runs_status ON training_runs(status);

-- 10. Data Ingestion Log Table
CREATE TABLE IF NOT EXISTS data_ingestion_log (
    ingestion_id BIGSERIAL PRIMARY KEY,
    source_filename VARCHAR(500) NOT NULL,
    file_hash VARCHAR(64) UNIQUE NOT NULL,
    records_parsed INTEGER,
    records_inserted INTEGER,
    records_updated INTEGER,
    records_skipped INTEGER,
    ingestion_started_at TIMESTAMPTZ DEFAULT NOW(),
    ingestion_completed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'processing',
    error_details JSONB
);
CREATE INDEX IF NOT EXISTS idx_ingestion_file_hash ON data_ingestion_log(file_hash);
CREATE INDEX IF NOT EXISTS idx_ingestion_status ON data_ingestion_log(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_started_at ON data_ingestion_log(ingestion_started_at DESC);

-- 11. Export Logs Table
CREATE TABLE IF NOT EXISTS export_logs (
    export_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(100),
    export_type VARCHAR(50),
    filters_applied JSONB,
    record_count INTEGER,
    file_size_bytes INTEGER,
    exported_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_export_exported_at ON export_logs(exported_at DESC);

-- Insert default crops
INSERT INTO crops (crop_name_en, is_active) VALUES
    ('Sorghum', TRUE),
    ('Wheat, Hard Winter', TRUE),
    ('Corn', TRUE),
    ('Soybean', TRUE),
    ('Cotton', TRUE),
    ('Fallow', TRUE),
    ('Cover Crop', TRUE),
    ('Sorghum Sudangrass', TRUE),
    ('Sunflower', TRUE),
    ('Oats', TRUE),
    ('Barley', TRUE),
    ('Millet', TRUE),
    ('Canola', TRUE)
ON CONFLICT (crop_name_en) DO NOTHING;
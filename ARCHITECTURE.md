# Nutrition AI - System Architecture

## Overview

Nutrition AI is a full-stack agricultural yield prediction platform that analyzes field management data to predict crop yields and provide actionable insights to farmers and agronomists.

### Key Features

1. **Yield Prediction** - ML-powered predictions based on fertilizer applications, location, crop type, and management practices
2. **Interactive Dashboard** - Filter, explore, and analyze field-season records
3. **Explainability** - SHAP values show which factors most influence predicted yields
4. **Model Versioning** - Track model performance over time with full provenance
5. **Data Ingestion** - Automated CSV import with deduplication and quality tracking
6. **Regional Comparisons** - Compare predictions against county/state averages
7. **Export Capabilities** - Download filtered data and field summaries

---

## System Architecture

```
┌─────────────────┐    ┌─────────────────────────────────────────┐
│   Frontend      │    │           Backend (FastAPI)             │
│   (Streamlit)   │◄──►│  ┌───────────────────────────────────┐ │
│   Port 8501     │    │  │   REST API Endpoints              │ │
└─────────────────┘    │  │  • Fields & Filtering             │ │
                        │  │  • Predictions                    │ │
                        │  │  • Model Management              │ │
                        │  │  • Exports                       │ │
                        │  └───────────────────────────────────┘ │
                        │               ▲                         │
                        │               │                         │
                        │  ┌────────────┴──────────────────────┐ │
                        │  │       Service Layer                │ │
                        │  │  • DataIngestionService           │ │
                        │  │  • RegionalStatsService           │ │
                        │  │  • PredictionService              │ │
                        │  └───────────────────────────────────┘ │
                        │               ▲                         │
                        │               │                         │
                        │  ┌────────────┴──────────────────────┐ │
                        │  │       ML Layer                     │ │
                        │  │  • ModelTrainer                   │ │
                        │  │  • Predictor (model loading)      │ │
                        │  │  • ExplainabilityEngine (SHAP)    │ │
                        │  │  • FeatureEngineer                │ │
                        │  │  • ModelRegistry (versioning)     │ │
                        │  └───────────────────────────────────┘ │
                        │               ▲                         │
                        └───────────────┼─────────────────────────┘
                                        │
                    ┌───────────────────┼─────────────────────┐
                    │                   │                     │
           ┌────────▼────────┐ ┌────────▼────────┐ ┌────────▼────────┐
           │   PostgreSQL    │ │     Redis       │ │   Models Disk   │
           │   Port 5432     │ │   Port 6379    │ │   ./models/     │
           │                 │ │                │ │                 │
           │ • fields        │ │ • Cache        │ │ • v1.0.0/       │
           │ • field_seasons │ │ • Queue        │ │   model.pkl     │
           │ • management_   │ │                │ │   features.json │
           │   events        │ └────────────────┘ │   metrics.json  │
           │ • model_versions│                    │   params.json   │
           │ • predictions   │                    └─────────────────┘
           │ • crops/var/season│
           └─────────────────┘
```

---

## Data Model

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `fields` | Unique field locations | field_number, acres, lat, long, county, state |
| `crops` | Crop lookup | crop_name_en |
| `varieties` | Variety lookup linked to crops | variety_name_en, crop_id |
| `seasons` | Growing seasons | season_year |
| `field_seasons` | Main fact table (field × season) | field_id, crop_id, variety_id, season_id, yield_bu_ac, totalN_per_ac, totalP_per_ac, totalK_per_ac |
| `management_events` | All operations (planting, fertilizer, spray, harvest) | field_season_id, event_type, start_date, amount, chemical_type |
| `model_versions` | ML model registry | version_tag, model_type, performance_metrics, feature_list |
| `model_predictions` | Predictions with explanations | field_season_id, model_version_id, predicted_yield, feature_contributions |
| `data_ingestion_log` | Track CSV imports | source_filename, file_hash, records_parsed |
| `training_runs` | MLOps tracking | model_version_id, git_commit_hash, training_duration_seconds |

### Data Flow

1. **Ingestion**: CSV → `DataIngestionService` → Populate tables
2. **Training**: Query `field_seasons` + `management_events` → Feature Engineering → Train → Save model
3. **Prediction**: Input → Feature Engineering → Model Inference → Store in `model_predictions`
4. **Dashboard**: Query `field_seasons` + joins + predictions → Display

---

## API Design

### RESTful Endpoints (v1)

All endpoints follow consistent patterns:

- `GET /api/v1/fields/overview` - Dashboard stats
- `GET /api/v1/fields/` - Filtered list with pagination
- `GET /api/v1/fields/{id}` - Detailed view
- `POST /api/v1/predict` - Single prediction
- `POST /api/v1/predict/batch` - Batch predictions
- `GET /api/v1/models/versions` - Model registry
- `POST /api/v1/models/train` - Trigger training
- `GET /api/v1/export/csv` - CSV export
- `GET /health` - Health check

All responses use consistent JSON schemas defined in `app/database/schemas.py`.

---

## Machine Learning Pipeline

### Feature Engineering (`app/ml/features.py`)

**Raw Features:**
- Numeric: acres, lat, long, season, N, P, K rates, event counts
- Categorical: crop, variety, state, county
- Management: event types, timing, equipment

**Engineered Features:**
- N:P, N:K, P:K ratios
- Total nutrients sum
- Nutrient × acres interactions
- Regional averages (county/state/crop)
- Target encoding for categoricals

### Model Training (`app/ml/trainer.py`)

1. Query training data from database with observed yields
2. Aggregate management events into field-season level
3. Apply feature engineering (with target encoding)
4. Train/test split (temporal split recommended for production)
5. Train model (LightGBM/XGBoost/RandomForest)
6. Evaluate metrics: R², RMSE, MAE
7. Save model artifacts via `ModelRegistry`
8. Register in `model_versions` table
9. Backfill predictions for training set (optional)

### Prediction (`app/ml/predictor.py`)

- Loads production model from registry (cached)
- Aligns input features with training feature list
- Applies feature engineering (without target encoding - uses frequency)
- Returns prediction with confidence interval
- Confidence interval = prediction ± 1.96 × validation_rmse

### Explainability (`app/ml/explainability.py`)

Uses SHAP (TreeExplainer) to compute feature contributions:

- `base_value`: Expected value (mean over background)
- `shap_value`: Contribution of each feature
- `direction`: Positive or negative impact
- `importance`: Normalized absolute SHAP value

Returned in prediction response for transparency.

---

## Frontend Dashboard (Streamlit)

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Header: Nutrition AI 🌱                           │
├─────────────┬──────────────┬────────────┬──────────┤
│ Filters     │ Field Table  │ Map View   │ Analytics│
│ (Sidebar)   │              │            │          │
│             │ Sortable,     │ Scatter    │ Charts:  │
│ • Season    │ clickable     │ map of     │ • Yield  │
│ • State     │ rows          │ fields     │   dist   │
│ • Crop      │              │            │ • N vs Y │
│ • Variety   │              │            │ • Reg    │
│ • Acres     │              │            │   comp   │
├─────────────┴──────────────┴────────────┴──────────┤
│  Predict Tab - Interactive form with SHAP display  │
├─────────────────────────────────────────────────────┤
│  Export section                                    │
└─────────────────────────────────────────────────────┘
```

### Key Components

1. **Filters** (sidebar)
   - Multi-select: seasons, crop, state
   - Text input: variety
   - Slider: acres range
   - Toggle: only with predictions

2. **Field Table**
   - Paginated (25/50/100 per page)
   - Sortable by clicking headers
   - Shows: field #, acres, crop, variety, season, observed yield, predicted yield, N/P/K totals
   - Row click opens detail view

3. **Detail View**
   - Field metadata (location, acres, grower)
   - Crop/variety/season
   - Yields (observed, target, predicted with CI)
   - Nutrient summary (N, P, K)
   - Management events timeline
   - Feature importance (SHAP)
   - Regional comparison

4. **Map View**
   - Plotly scatter mapbox
   - Color by yield, size by acres
   - Hover shows field details

5. **Analytics**
   - Yield distribution histogram
   - Predicted vs observed scatter with trendline
   - Nitrogen response curve
   - Regional averages by county (bar chart)

6. **Prediction**
   - Form with all input fields
   - Real-time prediction on submit
   - SHAP feature contributions
   - Regional comparison

7. **Export**
   - Download filtered data as CSV
   - Export single field summary as JSON

---

## Database Schema

### Normalization

- `fields` - one per physical field (unique field_number)
- `crops` and `varieties` - lookup tables
- `seasons` - years
- `field_seasons` - bridge table (many-to-one relationships)
- `management_events` - one-to-many with `field_seasons`

### Indexing Strategy

- **Lookup indexes**: `field_id`, `crop_id`, `season_id`, `state`, `county`
- **Geospatial**: `lat`, `long`
- **Performance**: `yield_bu_ac` for range queries, `created_at` for time-series

### Data Quality

- `data_quality_score` (0-1) on `field_seasons`
- `missing_data_flags` JSONB column tracks completeness
- File hash tracking prevents duplicate imports

---

## Deployment

### Docker Compose (Recommended)

```bash
docker-compose up -d
```

**Services:**
- `postgres:15-alpine` - Database
- `backend` - FastAPI (builds from `backend/Dockerfile`)
- `frontend` - Streamlit (builds from `frontend/Dockerfile`)
- `redis` - Cache/queue (optional)

**Volumes:**
- `postgres_data` - Database persistence
- `./models:/app/models` - Trained models
- `./data:/app/data` - CSV data

**Networking:**
- Internal network: services communicate by name
- Ports exposed: 5432 (DB), 8000 (API), 8501 (Dashboard)

### Manual Deployment

1. **Database**: Provision PostgreSQL 15+
2. **Backend**: Deploy FastAPI with Gunicorn + Uvicorn workers
3. **Frontend**: Deploy Streamlit behind reverse proxy (nginx)
4. **Models**: Shared volume or S3 for model artifacts
5. **Reverse Proxy**: nginx or Traefik for HTTPS termination

---

## Configuration

### Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection |
| `MODEL_PATH` | `models/` | Directory for trained models |
| `ENVIRONMENT` | `development` | `development` or `production` |
| `DEBUG` | `True` | Enable debug mode |
| `REDIS_URL` | `redis://...` | Redis connection (optional) |
| `SECRET_KEY` | (change me!) | For JWT/sessions |

---

## ML Model Lifecycle

### Training

```bash
python scripts/train_model.py \
  --model-type lightgbm \
  --start-season 2018 \
  --end-season 2024
```

Output:
- Model saved to `models/vYYYYMMDD_HHMMSS/`
- Entry created in `model_versions` table
- Metrics logged: R², RMSE, MAE
- Optional backfill of predictions

### Promotion

```bash
# Via API
curl -X POST http://localhost:8000/api/v1/models/versions/5/set-production

# Or manually in DB
UPDATE model_versions SET is_production = FALSE WHERE is_production = TRUE;
UPDATE model_versions SET is_production = TRUE WHERE model_version_id = 5;
```

### Retraining Strategy

- **Scheduled**: Monthly/quarterly retraining with all data
- **Triggered**: When performance degrades (drift detection)
- **Manual**: After data quality improvements

### Monitoring

- Compare validation metrics over time
- Track prediction distribution shifts
- Monitor feature importance changes
- Set up alerts for model failures

---

## Data Ingestion

### CSV Import

```bash
python scripts/import_data.py \
  --csv NSP_field_product_combined_all.csv \
  --source-filename "NSP_20250128.csv" \
  --chunk-size 10000
```

**Process:**
1. Compute SHA256 hash of file
2. Check `data_ingestion_log` for existing hash → skip if found
3. Read CSV in chunks (memory efficient)
4. For each row:
   - Parse and clean data
   - `GET or CREATE` crop, variety, season, field
   - Create/update `field_seasons` with aggregated nutrients
   - Create `management_events` for operation rows
5. Log statistics to `data_ingestion_log`

**Idempotency:** Same file can be safely re-imported; records will be updated (upsert) based on field-season uniqueness constraint.

---

## Future Enhancements

### Phase 2 (Post-MVP)

- [ ] Weather data integration (PRISM, NOAA APIs)
- [ ] Soil type layers (SSURGO)
- [ ] Multi-trait predictions (protein, starch, NIR)
- [ ] Fertilizer recommendation engine (what-if analysis)
- [ ] Crop rotation modeling
- [ ] Mobile-responsive frontend (PWA)
- [ ] User accounts and saved scenarios
- [ ] Email reports and alerts

### Phase 3 (Advanced)

- [ ] Deep learning models (Neural networks, Transformers for time series)
- [ ] Satellite imagery integration (Sentinel-2, Landsat)
- [ ] Real-time IoT sensor data
- [ ] Collaborative filtering (similar fields)
- [ ] A/B testing framework for model experiments
- [ ] Full MLOps: auto-retraining, drift detection, canary deployments
- [ ] Graph database for field relationships

### Phase 4 (Enterprise)

- [ ] Multi-tenancy (organizations)
- [ ] Role-based access control (RBAC)
- [ ] API rate limiting and quotas
- [ ] Audit logging
- [ ] SSO integration (SAML, OAuth)
- [ ] Advanced analytics notebooks
- [ ] Data warehouse integration (Snowflake, BigQuery)

---

## Performance Considerations

### Database

- Indexes on all foreign keys and filter columns
- Partition `management_events` by `field_season_id` or `start_date` for large datasets
- Use connection pooling (SQLAlchemy pool_size)
- Consider materialized views for pre-aggregated stats

### API

- Use `@st.cache_data` decorator for expensive queries
- Implement pagination (already done)
- Add response compression (GZip)
- Cache model in memory (already done in `PredictionService`)
- Consider async endpoints for I/O bound operations

### Frontend

- Streamlit caches data for 5 minutes by default
- Limit map to 2000 points for performance
- Use lazy loading for detail views
- Debounce filter changes

### ML

- Load model once per process (singleton pattern)
- Batch predictions for efficiency
- Use quantile regression forests for uncertainty (future)
- Consider ONNX for faster inference (future)

---

## Testing

### Unit Tests

```bash
pytest backend/tests/
```

Coverage targets:
- CRUD operations: 90%+
- Feature engineering: 95%+
- Prediction service: 85%+

### Integration Tests

- Test API endpoints with test database
- Test ingestion with sample CSV
- Test prediction accuracy on holdout set

### E2E Tests

- Streamlit dashboard interactions
- Full workflow: import → train → predict → export

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

---

## License

[Specify your license here]

---

## Contact

- **Project Lead**: [Your Name]
- **Tech Lead**: [Name]
- **Team**: Jake + Team

---

**Last Updated**: 2025-02-11
**Version**: 1.0.0

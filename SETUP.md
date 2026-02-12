# Nutrition AI - Setup Guide

This guide walks you through setting up the Nutrition AI platform on your local machine or a server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Docker)](#quick-start-docker)
- [Manual Setup](#manual-setup)
- [Loading Data](#loading-data)
- [Training the Model](#training-the-model)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have:

- **Python 3.11+** (`python --version`)
- **Docker & Docker Compose** (optional, for containerized setup)
- **PostgreSQL 15+** (if not using Docker)
- **Git** (for cloning repository)

### Optional but Recommended

- **Redis** (for caching and async tasks)
- **Make** (for using convenience commands)

---

## Quick Start (Docker)

The fastest way to get the platform running is using Docker Compose.

### 1. Clone and navigate

```bash
cd nutrition-ai
```

### 2. Prepare environment file

```bash
cp .env.example .env
# Edit .env if you need to customize database passwords
```

### 3. Build and start services

```bash
docker-compose up -d
```

This will start:
- PostgreSQL database on port 5432
- FastAPI backend on port 8000
- Streamlit dashboard on port 8501
- Redis (optional)

### 4. Initialize database

```bash
docker exec -it nutrition-ai-backend python scripts/init_db.py
```

### 5. Import your data

```bash
# Mount your CSV in docker-compose.yml under backend volumes:
# - ./data:/app/data

docker exec -it nutrition-ai-backend python scripts/import_data.py \
  --csv /app/data/NSP_field_product_combined_all.csv
```

### 6. Train the model

```bash
docker exec -it nutrition-ai-backend python scripts/train_model.py \
  --start-season 2018 --end-season 2025
```

### 7. Backfill predictions

```bash
docker exec -it nutrition-ai-backend python scripts/backfill_predictions.py
```

### 8. Access the application

- **Dashboard**: http://localhost:8502
- **API docs**: http://localhost:8001/docs
- **Health check**: http://localhost:8001/health

---

## Manual Setup

If you prefer to run services directly on your machine:

### 1. Install Python dependencies

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt

# Frontend
cd ../frontend
pip install -r requirements.txt
```

### 2. Start PostgreSQL

Using Docker:

```bash
docker run -d \
  -p 5432:5432 \
  -e POSTGRES_USER=nutrition \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=nutrition_ai \
  --name nutrition-postgres \
  postgres:15-alpine
```

Or install locally via package manager.

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 4. Create database tables

```bash
cd backend
alembic upgrade head
# Or simpler:
python scripts/init_db.py
```

### 5. Import data

```bash
python scripts/import_data.py --csv ../NSP_field_product_combined_all.csv
```

### 6. Train the model

```bash
python scripts/train_model.py --start-season 2018 --end-season 2025
```

### 7. Start the backend

```bash
uvicorn app.main:app --reload --port 8000
```

### 8. Start the frontend (in a new terminal)

```bash
cd frontend
streamlit run app.py
```

---

## Project Structure

```
nutrition-ai/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # REST API routes
│   │   ├── database/           # SQLAlchemy models & schemas
│   │   ├── ml/                 # ML models, training, prediction
│   │   ├── services/           # Business logic
│   │   └── utils/              # Helpers
│   ├── scripts/                # CLI utilities
│   └── requirements.txt
├── frontend/
│   ├── app.py                  # Streamlit dashboard
│   └── requirements.txt
├── docs/
│   └── database_schema.sql     # Full SQL schema
├── alembic/                    # Database migrations
├── docker-compose.yml          # Orchestration
├── README.md
└── SETUP.md                    # This file
```

---

## Loading Data

### CSV Format

Your CSV should have the same structure as `NSP_field_product_combined_all.csv`:

**Required columns:**
- `field` - Field number (unique identifier)
- `crop_name_en` - Crop type
- `season` - Year (integer)
- `totalN_per_ac`, `totalP_per_ac`, `totalK_per_ac` - Nutrient rates
- `acres`, `lat`, `long` - Field metadata
- `county`, `state` - Location
- `yield_bu_ac` - Observed yield (for training)

**Optional but useful:**
- `variety_name_en`
- `yield_target`
- `type`, `start`, `end` - Management events
- All the fertilizer/chemical detail columns

### Import Command

```bash
python backend/scripts/import_data.py \
  --csv /path/to/your/data.csv \
  --source-filename "NSP_2026.csv" \
  --chunk-size 10000
```

**Flags:**
- `--csv`: Path to CSV file (required)
- `--source-filename`: Friendly name for tracking (defaults to CSV basename)
- `--chunk-size`: Process N rows at a time (default: 10000, reduce if memory issues)

The import script will:
1. Compute file hash to avoid duplicate imports
2. Parse CSV in chunks (memory efficient)
3. Upsert fields, crops, varieties, seasons
4. Create field-season records with nutrient totals
5. Create management events from operation rows
6. Log ingestion progress

**Note:** Duplicate imports are automatically detected and skipped based on file hash.

---

## Training the Model

### Basic Training

```bash
python backend/scripts/train_model.py \
  --model-type lightgbm \
  --start-season 2018 \
  --end-season 2024
```

**Parameters:**
- `--model-type`: `lightgbm` (default), `xgboost`, or `random_forest`
- `--start-season` / `--end-season`: Training data date range
- `--test-size`: Validation split proportion (default: 0.2)
- `--random-seed`: Random seed for reproducibility (default: 42)

### What Training Does

1. Queries field-seasons with observed yields from database
2. Joins with management events to count operations
3. Performs feature engineering (ratios, interactions, target encoding)
4. Splits data into train/validation sets
5. Trains model with default hyperparameters
6. Evaluates metrics (R², RMSE, MAE)
7. Saves model artifacts to `models/{version_tag}/`
8. Registers model in `model_versions` table
9. Backfills predictions for training data

### Model Versioning

Models are saved with a version tag like `v20250211_123456`. Each version is stored in:

```
models/
  v20250211_123456/
    model.pkl          # Trained model
    features.json      # Feature names
    metrics.json       # R², RMSE, MAE
    params.json        # Hyperparams
```

The production model is marked in the database. Use `/api/v1/models/versions/{id}/set-production` to promote a version.

---

## Using the API

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/fields/overview` | Dashboard statistics |
| GET | `/api/v1/fields/` | List field-seasons (filtered) |
| GET | `/api/v1/fields/{id}` | Get field-season details |
| GET | `/api/v1/fields/crops/` | List all crops |
| GET | `/api/v1/fields/varieties/` | List varieties |
| POST | `/api/v1/predict` | Single yield prediction |
| POST | `/api/v1/predict/batch` | Batch predictions |
| GET | `/api/v1/models/versions` | List model versions |
| POST | `/api/v1/models/train` | Trigger training |
| POST | `/api/v1/models/versions/{id}/set-production` | Set production model |
| GET | `/api/v1/export/csv` | Export filtered data |
| GET | `/api/v1/export/field/{id}/summary` | Export field summary |
| GET | `/health` | Health check |

### Example: Get Data

```bash
curl "http://localhost:8000/api/v1/fields/?crop=Sorghum&season=2025&state=Kansas&limit=10"
```

### Example: Predict

```bash
curl -X POST "http://localhost:8000/api/v1/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "crop": "Sorghum",
    "acres": 50,
    "lat": 37.5,
    "long": -99.5,
    "season": 2025,
    "totalN_per_ac": 60,
    "totalP_per_ac": 40,
    "totalK_per_ac": 30
  }'
```

---

## Streamlit Dashboard

The dashboard (`frontend/app.py`) provides an interactive UI with:

- **Filters**: Season, state, crop, variety, acres range
- **Field Table**: Sortable, paginated list of field-seasons
- **Detail View**: Click a row to see full details including management events
- **Map**: Geographic scatter plot of fields
- **Analytics**: Yield distributions, N response curves, regional comparisons
- **Predict**: Interactive prediction form with explainability
- **Export**: Download filtered data as CSV

### Running the Dashboard

```bash
cd frontend
streamlit run app.py
```

Then open http://localhost:8501

The dashboard connects to the backend API (configure `API_URL` in app.py or via environment variable).

---

## Production Deployment

### Using Docker Compose (Recommended)

1. Update `.env` with production values:
   - Strong `POSTGRES_PASSWORD`
   - Set `ENVIRONMENT=production`
   - Set `DEBUG=false`

2. Build and run:

```bash
docker-compose up -d --build
```

3. Initialize DB and import data (as above).

4. For persistence, ensure volumes are mounted:
   - `postgres_data` - Database data
   - `./models:/app/models` - Trained models
   - `./data:/app/data` - CSV data

### Without Docker

1. Set up a production PostgreSQL database (consider RDS, Cloud SQL, etc.)
2. Deploy FastAPI with Gunicorn:

```bash
gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

3. Deploy Streamlit similarly or build with `streamlit run` behind a reverse proxy.

4. Use a process manager (systemd, supervisor) to keep services running.

---

## Troubleshooting

### Database Connection Errors

- Verify PostgreSQL is running: `docker ps` or `pg_isready`
- Check `DATABASE_URL` in `.env`
- Ensure database exists: `createdb nutrition_ai` or use Docker

### Import Fails on Memory

Reduce chunk size:

```bash
python scripts/import_data.py --csv data.csv --chunk-size 5000
```

Or increase Docker memory limit.

### Model Training Fails - No Data

Ensure field-seasons have observed yields (`yield_bu_ac` not null). Check your data:

```bash
psql -c "SELECT COUNT(*) FROM field_seasons WHERE yield_bu_ac IS NOT NULL;"
```

If zero, you need to import data with yield values or use historical data only for feature engineering (but then you need labels to train).

### SHAP/Explainability Errors

LightGBM and XGBoost are supported. For RandomForest, ensure scikit-learn version >= 1.0.

---

## Next Steps

- Add user authentication
- Implement automated model retraining (cron job / Celery)
- Integrate weather data
- Add fertilizer recommendation engine
- Mobile-responsive frontend

---

## Support

For issues, questions, or contributions, please open an issue in the repository.

---

**Version**: 1.0.0 | **Last Updated**: 2025-02-11
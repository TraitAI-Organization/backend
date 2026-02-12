# Nutrition AI

Nutrition AI is an agricultural yield prediction platform with:
- a FastAPI backend
- a Streamlit dashboard
- a PostgreSQL data layer
- an ML pipeline for model training, prediction, and explainability

It supports CSV ingestion, field-level filtering, model versioning, and yield prediction with confidence intervals.

## What You Get

- Yield prediction from crop, location, season, and N/P/K inputs
- Dashboard for overview metrics, field table, map, analytics, and prediction form
- CSV export for filtered records
- Model training/version management APIs
- Bulk data ingestion (CLI or API upload)

## Tech Stack

- Backend: FastAPI, SQLAlchemy, Alembic
- Database: PostgreSQL 15
- ML: scikit-learn, LightGBM, XGBoost, SHAP
- Frontend: Streamlit + Plotly
- Infra: Docker Compose, Redis (optional)

## Repository Layout

```text
nutriotion-ai/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/    # API endpoints
│   │   ├── database/            # models, CRUD, session, schemas
│   │   ├── ml/                  # trainer, predictor, explainability
│   │   ├── services/            # ingestion and regional services
│   │   └── config.py
│   ├── scripts/                 # init_db, import_data, train_model, backfill_predictions
│   └── requirements.txt
├── frontend/
│   ├── app.py                   # Streamlit UI
│   └── requirements.txt
├── alembic/                     # DB migrations
├── docs/
│   └── database_schema.sql
├── docker-compose.yml
├── .env.example
├── QUICKSTART.md
├── SETUP.md
└── ARCHITECTURE.md
```

## Prerequisites

- Docker + Docker Compose (recommended)
- or Python 3.11+ and PostgreSQL 15+ for local/manual setup

## Quick Start (Docker)

1. Start services:

```bash
docker compose up -d --build
```

2. Initialize database tables:

```bash
docker compose exec backend python scripts/init_db.py
```

3. Import data (CSV file should be in `./data/`):

```bash
docker compose exec backend python scripts/import_data.py \
  --csv /app/data/NSP_field_product_combined_all.csv
```

4. Train an initial model:

```bash
docker compose exec backend python scripts/train_model.py \
  --model-type lightgbm \
  --start-season 2018 \
  --end-season 2024
```

5. Optional: backfill predictions for historical records:

```bash
docker compose exec backend python scripts/backfill_predictions.py
```

6. Open the apps:

- Dashboard: `http://localhost:8502`
- API docs: `http://localhost:8001/docs`
- Health: `http://localhost:8001/health`
- Admin panel: `http://localhost:8001/admin`

### Docker Ports

- PostgreSQL: `5433` (container `5432`)
- Backend API: `8001` (container `8000`)
- Frontend: `8502` (container `8501`)
- Redis: `6380` (container `6379`)

## Manual Setup (Local)

1. Create env file:

```bash
cp .env.example .env
```

2. Start PostgreSQL and ensure `DATABASE_URL` in `.env` is correct.
   If you are using the PostgreSQL container from this repo, use host port `5433`.

3. Install backend deps:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

4. Run DB migrations from repo root (in a terminal with backend env available):

```bash
alembic upgrade head
```

5. Run backend:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

6. Run frontend in a new terminal:

```bash
cd frontend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
API_URL=http://localhost:8000 streamlit run app.py
```

## Data Operations

### Import CSV

```bash
cd backend
python scripts/import_data.py \
  --csv ../NSP_field_product_combined_all.csv \
  --source-filename NSP_field_product_combined_all.csv \
  --chunk-size 10000
```

### Train Model

```bash
cd backend
python scripts/train_model.py \
  --model-type lightgbm \
  --start-season 2018 \
  --end-season 2024 \
  --test-size 0.2 \
  --random-seed 42
```

### Backfill Predictions

```bash
cd backend
python scripts/backfill_predictions.py --batch-size 1000
```

## Admin Panel

The backend now includes a first-class admin control plane at `/admin` for:
- model training jobs
- model deployment (set production model)
- prediction backfill jobs
- ingestion log monitoring
- live admin job status
- GUI field builder (manage dropdown options and custom fields for forms)

If `ADMIN_API_KEY` is set, admin API actions require `X-Admin-Key`.
The `/admin` UI includes a key field and stores it in browser localStorage for convenience.

## API Quick Reference

Base URL (Docker): `http://localhost:8001`

### Core

- `GET /health`
- `GET /`
- `GET /docs`

### Fields

- `GET /api/v1/fields/overview`
- `GET /api/v1/fields`
- `GET /api/v1/fields/{field_season_id}`
- `GET /api/v1/fields/crops/`
- `GET /api/v1/fields/varieties/`
- `GET /api/v1/fields/seasons/`

Example:

```bash
curl "http://localhost:8001/api/v1/fields?crop=Sorghum&season=2025&state=Kansas&limit=50"
```

### Predictions

- `POST /api/v1/predict`
- `POST /api/v1/predict/batch`

Example:

```bash
curl -X POST "http://localhost:8001/api/v1/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "crop": "Sorghum",
    "variety": "Pioneer 86P20",
    "acres": 47.07,
    "lat": 37.567,
    "long": -99.936,
    "season": 2025,
    "totalN_per_ac": 65.6,
    "totalP_per_ac": 45.2,
    "totalK_per_ac": 30.1
  }'
```

### Models

- `GET /api/v1/models/versions`
- `GET /api/v1/models/versions/{version_id}`
- `POST /api/v1/models/train`
- `POST /api/v1/models/versions/{version_id}/set-production`
- `GET /api/v1/models/production`
- `GET /api/v1/models/performance`

### Exports

- `GET /api/v1/export/csv`
- `GET /api/v1/export/field/{field_season_id}/summary?format=json|csv`

### Data Ingestion APIs

- `POST /api/v1/data/upload` (multipart CSV upload)
- `GET /api/v1/data/ingestion/logs`

### Manual Entry APIs

- `POST /api/v1/manual-entry/manual-entry`
- `GET /api/v1/manual-entry/manual-entry/schema`

### Admin APIs (new)

- `GET /admin` (web admin panel)
- `GET /admin/api/system-status`
- `GET /admin/api/models`
- `POST /admin/api/models/train`
- `POST /admin/api/models/set-production`
- `POST /admin/api/predictions/backfill`
- `GET /admin/api/ingestion-logs`
- `GET /admin/api/jobs`
- `GET /admin/api/jobs/{job_id}`
- `GET /admin/api/ui-config` (admin)
- `GET /admin/api/ui-config/public?form_key=manual_entry|prediction` (frontend-safe read)
- `POST /admin/api/ui-config/dropdown-option/add`
- `POST /admin/api/ui-config/dropdown-option/remove`
- `POST /admin/api/ui-config/custom-field/upsert`
- `POST /admin/api/ui-config/custom-field/delete`

## Configuration

Main environment variables (`.env`):

```bash
# Database
DATABASE_URL=postgresql://nutrition:password@localhost:5432/nutrition_ai
POSTGRES_USER=nutrition
POSTGRES_PASSWORD=password
POSTGRES_DB=nutrition_ai

# App
SECRET_KEY=change-this-to-a-random-secret-key-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=30
ENVIRONMENT=development
DEBUG=True
ADMIN_API_KEY=
UI_CONFIG_PATH=data/ui_config.json

# ML
MODEL_PATH=models/
MODEL_VERSION=v1.0.0

# Optional
REDIS_URL=redis://localhost:6379/0
```

## Useful Commands

```bash
# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop services
docker compose down

# Rebuild from scratch
docker compose down -v
docker compose up -d --build
```

## Tests

`backend/tests/` is present but currently empty. When tests are added, run:

```bash
pytest backend/tests/
```

## Troubleshooting

- `No production model available`: train a model first, then retry prediction.
- `Failed to fetch overview` in dashboard: verify backend is up and reachable at `API_URL`.
- DB connection errors in Docker: ensure API uses compose network DB host (`postgres`) and container port `5432`.
- Large CSV import memory pressure: lower `--chunk-size` (for example, `5000`).

## Additional Docs

- `QUICKSTART.md`: short bootstrap flow
- `SETUP.md`: detailed setup walkthrough
- `ARCHITECTURE.md`: system design and implementation details
- `docs/database_schema.sql`: database schema reference

## License

No license is declared yet. Add a license file and update this section before external distribution.

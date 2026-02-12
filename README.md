# Nutrition AI

Agricultural yield prediction platform with ML-powered insights for farmers and agronomists.

## Features

- **Yield Prediction**: Predict crop yields based on fertilizer applications, location, and management practices
- **Interactive Dashboard**: Filter and explore field-season records with sortable tables and visualizations
- **Explainability**: Understand key factors driving yield predictions (SHAP values)
- **Model Versioning**: Track model performance and improvements over time
- **Data Ingestion**: Automated CSV import with deduplication and provenance tracking

## Tech Stack

- **Backend**: FastAPI + PostgreSQL
- **ML**: LightGBM/XGBoost + SHAP
- **Frontend**: Streamlit (MVP) / React (production)
- **Infrastructure**: Docker, Redis (optional)

## Quick Start

### 1. Clone and setup

```bash
cd nutrition-ai
cp .env.example .env
# Edit .env with your database credentials
```

### 2. Start with Docker Compose

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- FastAPI backend on port 8000
- Streamlit dashboard on port 8501

### 3. Import initial data

```bash
# From the backend container
docker exec -it nutrition-ai-backend python scripts/import_data.py \
  --csv /data/NSP_field_product_combined_all.csv

# Or locally if database is accessible
python scripts/import_data.py --csv ../NSP_field_product_combined_all.csv
```

### 4. Train initial model

```bash
docker exec -it nutrition-ai-backend python scripts/train_model.py \
  --start-season 2018 --end-season 2024
```

### 5. Access the application

- **Dashboard**: http://localhost:8501
- **API docs**: http://localhost:8000/docs
- **Health check**: http://localhost:8000/health

## Project Structure

```
nutrition-ai/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/    # REST API endpoints
│   │   ├── database/            # SQLAlchemy models & schemas
│   │   ├── ml/                  # ML models, training, explainability
│   │   ├── services/            # Business logic layer
│   │   └── utils/               # Helpers, validators
│   ├── scripts/                 # Data import, training, management
│   ├── tests/                   # Unit and integration tests
│   └── requirements.txt
├── frontend/
│   ├── app.py                   # Streamlit dashboard (MVP)
│   └── requirements.txt
├── docs/                        # Additional documentation
├── scripts/                     # One-off scripts
├── alembic/                     # Database migrations
├── docker-compose.yml
├── .env.example
└── README.md
```

## API Quick Reference

### Filter Fields

```
GET /api/v1/fields/?crop=Sorghum&season=2025&state=Kansas&limit=50
```

### Get Prediction

```
POST /api/v1/predict
{
  "crop": "Sorghum",
  "variety": "Pioneer 86P20",
  "acres": 47.07,
  "lat": 37.567,
  "long": -99.936,
  "season": 2025,
  "totalN_per_ac": 65.6,
  "totalP_per_ac": 45.2,
  "totalK_per_ac": 30.1
}
```

### Model Info

```
GET /api/v1/models/versions
```

## Development

### Setup local environment

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt
pip install -r frontend/requirements.txt

# Start PostgreSQL (using Docker)
docker run -d -p 5432:5432 \
  -e POSTGRES_USER=nutrition \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_DB=nutrition_ai \
  postgres:15

# Run database migrations
cd backend
alembic upgrade head

# Start backend
uvicorn app.main:app --reload --port 8000

# In another terminal, start frontend
cd frontend
streamlit run app.py
```

### Run tests

```bash
pytest backend/tests/
```

## Data Model

### Core Tables

- **fields**: Unique field locations with geographic info
- **field_seasons**: Field × Season combinations (main fact table)
- **management_events**: All operations (planting, fertilizer, spray, harvest)
- **model_versions**: ML model metadata and performance
- **model_predictions**: Predictions with explainability data

See `docs/database_schema.sql` for full schema.

## Configuration

Environment variables in `.env`:

```bash
DATABASE_URL=postgresql://user:pass@localhost/nutrition_ai
SECRET_KEY=your-secret-key-here
MODEL_PATH=models/
ENVIRONMENT=development  # or production
```

## License

[Your License Here]

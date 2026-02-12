# 🚀 Nutrition AI - Quick Start Guide

Get the platform up and running in 5 minutes!

---

## Prerequisites Check

```bash
# Verify you have these installed:
docker --version        # Docker 20+
docker-compose --version  # Docker Compose 2+
python --version        # Python 3.11+ (optional, for manual setup)
```

---

## Option 1: Docker (Fastest - 5 min)

### 1. Start Everything

```bash
cd nutrition-ai
docker-compose up -d
```

Wait ~30 seconds for services to start.

### 2. Initialize Database

```bash
docker exec -it nutrition-ai-backend python scripts/init_db.py
```

### 3. Import Your Data

```bash
# Place your CSV in the project root or create a data/ folder
mkdir -p data
# Copy your CSV: NSP_field_product_combined_all.csv into data/

docker exec -it nutrition-ai-backend python scripts/import_data.py \
  --csv /app/data/NSP_field_product_combined_all.csv
```

### 4. Train Model

```bash
docker exec -it nutrition-ai-backend python scripts/train_model.py \
  --start-season 2018 --end-season 2025
```

### 5. Access the Platform

- 🌱 **Dashboard**: http://localhost:8502  (changed from 8501)
- 🔧 **API Docs**: http://localhost:8001/docs  (changed from 8000)
- ❤️ **Health**: http://localhost:8001/health  (changed from 8000)

---

## Option 2: Manual Setup (10 min)

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Start PostgreSQL

```bash
# Using Docker:
docker run -d -p 5432:5432 \
  -e POSTGRES_USER=nutrition \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=nutrition_ai \
  --name nutrition-postgres \
  postgres:15-alpine
```

### 3. Configure Environment

```bash
cp ../.env.example ../.env
# Edit .env if needed (defaults work for local setup)
```

### 4. Initialize DB

```bash
alembic upgrade head
# OR: python scripts/init_db.py
```

### 5. Import Data & Train (same as Docker steps 3-4 above)

```bash
python scripts/import_data.py --csv ../NSP_field_product_combined_all.csv
python scripts/train_model.py --start-season 2018 --end-season 2025
```

### 6. Start Services

**Terminal 1 - Backend:**
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
streamlit run app.py
```

---

## Troubleshooting

### "Database connection refused"

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# If not running:
docker-compose up -d postgres
# OR restart your local PostgreSQL service
```

### "No production model available"

Train a model first:
```bash
python scripts/train_model.py --start-season 2018 --end-season 2024
```

### "Failed to fetch data" in dashboard

Check backend logs:
```bash
docker logs nutrition-ai-backend
# OR if manual: check uvicorn terminal output
```

### Import fails with memory error

Reduce chunk size:
```bash
python scripts/import_data.py --csv data.csv --chunk-size 5000
```

---

## Testing the API

### Quick health check:

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "healthy",
  "timestamp": 173917..., 
  "version": "1.0.0",
  "environment": "development"
}
```

### Get overview stats:

```bash
curl http://localhost:8000/api/v1/fields/overview
```

### Predict yield:

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

## Common Commands

### Docker

```bash
# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop everything
docker-compose down

# Stop and remove volumes (WARNING: deletes data)
docker-compose down -v

# Restart a service
docker-compose restart backend

# Execute command in container
docker exec -it nutrition-ai-backend bash
```

### Database

```bash
# Connect to database
docker exec -it nutrition-postgres psql -U nutrition -d nutrition_ai

# Count records
SELECT COUNT(*) FROM field_seasons;

# Check model versions
SELECT * FROM model_versions ORDER BY training_date DESC;
```

### Training

```bash
# Train different model types
python scripts/train_model.py --model-type xgboost
python scripts/train_model.py --model-type random_forest

# Different season range
python scripts/train_model.py --start-season 2020 --end-season 2025
```

---

## Project Structure at a Glance

```
nutrition-ai/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app entry
│   │   ├── config.py         # Settings
│   │   ├── api/v1/endpoints/ # API routes
│   │   ├── database/         # Models & schemas
│   │   ├── ml/               # ML models, training, prediction
│   │   └── services/         # Business logic
│   └── scripts/              # CLI tools
├── frontend/
│   └── app.py                # Streamlit dashboard
├── docs/
│   └── database_schema.sql   # Full SQL schema
├── alembic/                  # Database migrations
├── docker-compose.yml        # Orchestration
├── README.md                 # Project overview
├── SETUP.md                  # Detailed setup guide
├── ARCHITECTURE.md           # System design
└── QUICKSTART.md             # This file
```

---

## Next Steps

1. ✅ **Import your data** - Ensure you have the combined CSV
2. ✅ **Train a model** - Use at least 3 years of data
3. ✅ **Test predictions** - Use the /predict endpoint or dashboard
4. ✅ **Explore dashboard** - Apply filters, view details, check explainability
5. 🔄 **Set up retraining** - Schedule periodic model updates
6. 🔄 **Add weather data** - Enhance features with climate data
7. 🔄 **Customize for** - Adapt to your specific crops and regions

---

## Need Help?

1. **Check logs**: `docker-compose logs -f backend`
2. **Verify data**: `SELECT COUNT(*) FROM field_seasons WHERE yield_bu_ac IS NOT NULL;`
3. **Read full docs**: See `SETUP.md` and `ARCHITECTURE.md`
4. **Test API**: Visit http://localhost:8000/docs for interactive API testing

---

## What's Working Now?

✅ PostgreSQL database with complete schema
✅ FastAPI backend with all endpoints
✅ ML pipeline (feature engineering, training, prediction)
✅ Model versioning and registry
✅ SHAP explainability
✅ Streamlit dashboard with all requested features:
   - Filtering (season, state, crop, variety, acres)
   - Sortable field table
   - Detail view with management events
   - Prediction form with SHAP display
   - Regional comparisons
   - Map view
   - Analytics charts
   - CSV export

---

**You're ready to go!** 🎉

Start with `docker-compose up -d` and open http://localhost:8501
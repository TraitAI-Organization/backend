# Nutrition AI API Reference

## Base URLs

- Production (example): `https://traitharvest.ai`
- Local docker: `http://localhost:8001`
- OpenAPI UI: `/docs`
- OpenAPI JSON: `/openapi.json`

## CORS (React/External Frontends)

- Controlled by env vars:
  - `CORS_ORIGINS` (default `*`, comma-separated when specific)
  - `CORS_ALLOW_CREDENTIALS` (default `false`)
- Recommended for public SPA clients:
  - `CORS_ORIGINS=*`
  - `CORS_ALLOW_CREDENTIALS=false`

## Auth

- Most `/api/v1/*` endpoints do not require auth.
- `/admin/api/*` endpoints require `X-Admin-Key` only if `ADMIN_API_KEY` is configured.

## Core

1. `GET /`
Description: API metadata.
Response:
```json
{"name":"Nutrition AI API","version":"1.0.0","docs":"/docs","health":"/health"}
```

2. `GET /health`
Description: service and DB health.
Response fields: `status`, `database`, `timestamp`, `version`, `environment`.

## Fields APIs

1. `GET /api/v1/fields/overview`
Description: dashboard aggregates (counts, filters, yield range, latest model info).

2. `GET /api/v1/fields`
Description: paginated field-season listing.
Query params:
- `crop`, `variety`, `state`, `county`
- `season` (repeatable: `?season=2024&season=2025`)
- `min_acres`, `max_acres`
- `has_prediction`
- `min_yield`, `max_yield`
- `page` (default `1`)
- `limit` (default `50`, max `500`)

Response:
```json
{"data":[...],"total":123,"page":1,"limit":50,"pages":3}
```

3. `GET /api/v1/fields/{field_season_id}`
Description: detailed field-season record with field/crop/season/events/predictions.
Path param: `field_season_id` (int).

4. `GET /api/v1/fields/crops/`
Query: `active_only=true|false` (default `true`).

5. `GET /api/v1/fields/varieties/`
Query: `crop` (optional), `active_only=true|false` (default `true`).

6. `GET /api/v1/fields/seasons/`
Description: seasons list.

## Prediction APIs

1. `POST /api/v1/predict`
Description: single prediction using current production model.
Request body:
```json
{
  "crop": "Sorghum",
  "variety": "Optional",
  "acres": 50.0,
  "lat": 37.5,
  "long": -99.5,
  "season": 2025,
  "totalN_per_ac": 60.0,
  "totalP_per_ac": 40.0,
  "totalK_per_ac": 30.0,
  "water_applied_mm": 0,
  "event_count": 0,
  "county": "Ford",
  "state": "Kansas"
}
```
Response:
```json
{
  "predicted_yield": 67.7,
  "confidence_interval": [48.1, 87.3],
  "model_version": "genmills_cbmodel_v2",
  "regional_comparison": {},
  "explainability": {"top_features":[{"feature":"...","value":1,"direction":"positive","importance":0.22}]},
  "recommendations": null
}
```
Common errors:
- `503`: no production model set
- `400`: invalid request/business validation

2. `POST /api/v1/predict/batch`
Description: batch prediction.
Request body: array of `PredictionRequest` objects.
Response:
```json
{"predictions":[...],"total":2}
```

## Model APIs

1. `GET /api/v1/models/versions`
Query: `limit` (default `20`), `active_only` (default `false`).

2. `GET /api/v1/models/versions/{version_id}`
Description: one model version with run details.

3. `POST /api/v1/models/train`
Query params:
- `model_type` (`lightgbm|xgboost|random_forest`)
- `start_season` (default `2018`)
- `end_season` (default `2024`)
- `test_size` (`0.1` to `0.5`, default `0.2`)

4. `POST /api/v1/models/versions/{version_id}/set-production`
Description: mark model version as production.

5. `GET /api/v1/models/production`
Description: current production model.

6. `GET /api/v1/models/performance`
Query: `model_version` (optional version tag).

## Export APIs

1. `GET /api/v1/export/csv`
Description: CSV download for filtered fields.
Filters: same as `GET /api/v1/fields`.

2. `GET /api/v1/export/field/{field_season_id}/summary`
Query: `format=json|csv` (default `json`).

## Data Upload APIs

1. `POST /api/v1/data/upload`
Description: multipart CSV upload and ingestion.
Form fields:
- `file` (required, `.csv`)
- `source_filename` (optional)

2. `GET /api/v1/data/ingestion/logs`
Query: `limit` (default `20`).

## Manual Entry APIs

1. `POST /api/v1/manual-entry/manual-entry`
Description: submit a single manual record.
Request body: `ManualEntryCreate` schema.

2. `GET /api/v1/manual-entry/manual-entry/schema`
Description: dynamic form schema for frontend rendering.

## Admin APIs

Header (if enabled):
```http
X-Admin-Key: <ADMIN_API_KEY>
```

1. `GET /admin`
Description: admin UI (HTML).

2. `GET /admin/api/system-status`
Description: DB/app/model overview status.

3. `GET /admin/api/models?limit=50`
Description: model list for admin UI.

4. `POST /admin/api/models/train`
Body:
```json
{
  "model_type":"lightgbm",
  "start_season":2018,
  "end_season":2024,
  "test_size":0.2,
  "random_seed":42,
  "set_production":true
}
```
Returns: queued job id.

5. `POST /admin/api/models/set-production`
Body:
```json
{"version_id": 1}
```

6. `POST /admin/api/predictions/backfill`
Body:
```json
{"batch_size":1000}
```
Returns: queued job id.

7. `GET /admin/api/ingestion-logs?limit=20`

8. `GET /admin/api/ui-config`
Description: full UI config (admin).

9. `GET /admin/api/ui-config/public?form_key=manual_entry|prediction`
Description: public-safe config for frontend form rendering.

10. `POST /admin/api/ui-config/dropdown-option/add`
11. `POST /admin/api/ui-config/dropdown-option/remove`
Body:
```json
{"form_key":"prediction","field_key":"state","option":"Kansas"}
```

12. `POST /admin/api/ui-config/custom-field/upsert`
Body:
```json
{
  "form_key":"prediction",
  "field_key":"soil_ph",
  "label":"Soil pH",
  "type":"number",
  "required":false,
  "payload_key":"soil_ph"
}
```

13. `POST /admin/api/ui-config/custom-field/delete`
Body:
```json
{"form_key":"prediction","field_key":"soil_ph"}
```

14. `GET /admin/api/jobs`
15. `GET /admin/api/jobs/{job_id}`
Description: training/backfill job status and result.

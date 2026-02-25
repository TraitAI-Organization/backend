# Model Sync (Bulk Register + Dedupe)

Use this when new model folders are copied into `models/`.

## Run on EC2

From project root:

```bash
docker compose -f docker-compose.landing.yml exec backend \
python -m scripts.sync_models --set-production-if-missing --dedupe
```

What it does:
- normalizes CatBoost folders to runtime artifacts (`model.cbm`, `features.json`, `metrics.json`, `params.json`)
- normalizes deep learning folders with `.pth/.pt` into runtime artifacts (`model.pth`, generated `features.json`, `metrics.json`, `params.json`)
- registers all valid folders into `model_versions`
- keeps one production model if none is set
- removes duplicates by model fingerprint (skips production version)

## Verify

```bash
curl -sS https://traitharvest.ai/api/v1/models/versions
curl -sS https://traitharvest.ai/api/v1/models/production
curl -sS -X POST https://traitharvest.ai/api/v1/predict/all-models \
  -H "Content-Type: application/json" \
  -d '{"crop":"Sorghum","acres":50,"lat":37.5,"long":-99.5,"season":2025,"totalN_per_ac":60,"totalP_per_ac":40,"totalK_per_ac":30}'
curl -sS -X POST https://traitharvest.ai/api/v1/predict/model/genmills_cbmodel_v2 \
  -H "Content-Type: application/json" \
  -d '{"crop":"Sorghum","acres":50,"lat":37.5,"long":-99.5,"season":2025,"totalN_per_ac":60,"totalP_per_ac":40,"totalK_per_ac":30}'
```

## Localhost quick test

```bash
curl -sS http://localhost:8001/health
curl -sS -X POST http://localhost:8001/api/v1/predict/all-models \
  -H "Content-Type: application/json" \
  -d '{"crop":"Sorghum","acres":50,"lat":37.5,"long":-99.5,"season":2025,"totalN_per_ac":60,"totalP_per_ac":40,"totalK_per_ac":30}'
curl -sS -X POST http://localhost:8001/api/v1/predict/model/genmills_cbmodel_v2 \
  -H "Content-Type: application/json" \
  -d '{"crop":"Sorghum","acres":50,"lat":37.5,"long":-99.5,"season":2025,"totalN_per_ac":60,"totalP_per_ac":40,"totalK_per_ac":30}'
```

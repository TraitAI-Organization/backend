# GenMills External Model Import Guide

This project now includes imported CatBoost artifacts from `model_specific_files/CBModel_v2`.

## Imported Artifact Folder

`models/genmills_cbmodel_v2/`

Includes:
- `model.cbm`
- `features.json`
- `metrics.json`
- `params.json`
- `feature_columns.json`
- `categorical_features.json`
- `crop_statistics.csv`
- supporting report/figures

## Repeatable Import (from source folder)

From repo root:

```bash
cd backend
python scripts/import_external_model.py \
  --source-dir ../model_specific_files/CBModel_v2 \
  --version-tag genmills_cbmodel_v2 \
  --report-file ../model_specific_files/GenMills\ modelling\ report.docx
```

## Register in Database

```bash
cd backend
python scripts/register_model_version.py --version-tag genmills_cbmodel_v2
```

Set as production (optional):

```bash
cd backend
python scripts/register_model_version.py --version-tag genmills_cbmodel_v2 --set-production
```

## Runtime Notes

- `ModelRegistry` now supports both:
  - `model.pkl` (joblib)
  - `model.cbm` (CatBoost)
- Explainability is best-effort; prediction responses still return even when SHAP explanation is unavailable for external models.
- CatBoost dependency is required in backend runtime (`catboost` added to `backend/requirements.txt`).


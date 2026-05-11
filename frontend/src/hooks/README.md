# TraitHarvestAI — Hooks

This directory contains custom React hooks used by the TraitHarvestAI frontend.

TraitHarvestAI is an agricultural yield prediction platform developed by Shakoor Lab. The hooks here support shared frontend behavior — local storage state, configuration access, route helpers, and other utilities reused across the dashboard.

## About TraitHarvestAI

TraitHarvestAI provides:

- Yield prediction from crop, location, season, and N/P/K inputs
- A dashboard for overview metrics, field tables, maps, analytics, and a prediction form
- CSV export for filtered records
- Model training and version management APIs
- Bulk data ingestion (CLI or API upload)

Backend: FastAPI, SQLAlchemy, Alembic, PostgreSQL.
ML: scikit-learn, LightGBM, XGBoost, SHAP.
Frontend: React + Material-UI.

For project-level setup and architecture, see the repository root: `README.md`, `QUICKSTART.md`, `SETUP.md`, and `ARCHITECTURE.md`.

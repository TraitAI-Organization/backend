#!/usr/bin/env python
"""
Register an existing artifact folder in ./models as a model version in DB.

Example:
  python scripts/register_model_version.py --version-tag genmills_cbmodel_v2 --set-production
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.database import crud, models


def main() -> int:
    parser = argparse.ArgumentParser(description="Register model artifacts in model_versions table")
    parser.add_argument("--version-tag", required=True, help="Folder name under ./models")
    parser.add_argument("--model-type", default="catboost", help="Model type label to store in DB")
    parser.add_argument("--set-production", action="store_true", help="Set this version as production after registration")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    artifact_dir = repo_root / "models" / args.version_tag
    features_path = artifact_dir / "features.json"
    metrics_path = artifact_dir / "metrics.json"
    params_path = artifact_dir / "params.json"

    for p in [features_path, metrics_path, params_path]:
        if not p.exists():
            raise FileNotFoundError(f"Missing artifact file: {p}")

    features_payload = json.loads(features_path.read_text())
    metrics_payload = json.loads(metrics_path.read_text())
    params_payload = json.loads(params_path.read_text())

    feature_list = features_payload.get("feature_names", [])
    preprocessing_steps = features_payload.get("preprocessing", {})

    # Keep metrics numeric because API schema expects Dict[str, float]
    numeric_metrics = {}
    for k, v in metrics_payload.items():
        if isinstance(v, (int, float)):
            numeric_metrics[k] = float(v)

    db: Session = SessionLocal()
    try:
        existing = (
            db.query(models.ModelVersion)
            .filter(models.ModelVersion.version_tag == args.version_tag)
            .first()
        )
        if existing:
            print(f"Model version already exists: {args.version_tag} (id={existing.model_version_id})")
            if args.set_production:
                crud.set_production_model(db, existing.model_version_id)
                print(f"Set production model: {args.version_tag}")
            return 0

        db_model = models.ModelVersion(
            version_tag=args.version_tag,
            model_type=args.model_type,
            model_params=params_payload,
            training_data_range={"source": "external_import"},
            # API schema for model metrics expects numeric values only.
            performance_metrics=numeric_metrics,
            feature_list=feature_list,
            preprocessing_steps=preprocessing_steps,
            notes="Imported external model artifacts",
            created_by="external_import_script",
            is_production=False,
        )
        db.add(db_model)
        db.commit()
        db.refresh(db_model)
        print(f"Registered model version: {args.version_tag} (id={db_model.model_version_id})")

        if args.set_production:
            crud.set_production_model(db, db_model.model_version_id)
            print(f"Set production model: {args.version_tag}")

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

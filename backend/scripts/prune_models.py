#!/usr/bin/env python
"""
Keep only selected model versions (typically one CatBoost + one Deep Learning).

Examples:
  python -m scripts.prune_models
  python -m scripts.prune_models --apply --delete-folders
  python -m scripts.prune_models --apply --keep-catboost-tag genmills_cbmodel_v2 --keep-deep-tag "Deep Learning Model" --delete-folders
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.database import models, crud
from app.database.session import SessionLocal


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def _is_catboost(mv: models.ModelVersion) -> bool:
    tag = (mv.version_tag or "").lower()
    if (mv.model_type or "").lower() == "catboost":
        return True
    if "catboost" in tag or "cbmodel" in tag:
        return True
    preprocessing = _as_dict(mv.preprocessing_steps)
    ext_type = str(preprocessing.get("external_model_type") or "").lower()
    return ext_type == "catboost"


def _is_deep_learning(mv: models.ModelVersion) -> bool:
    tag = (mv.version_tag or "").lower()
    if "deep" in tag:
        return True
    model_params = _as_dict(mv.model_params)
    artifact = str(model_params.get("artifact_file") or "").lower()
    if artifact.endswith(".pth") or artifact.endswith(".pt"):
        return True
    preprocessing = _as_dict(mv.preprocessing_steps)
    ext_type = str(preprocessing.get("external_model_type") or "").lower()
    return "deep_learning" in ext_type or ext_type == "pytorch"


def _pick_by_tag(db: Session, version_tag: Optional[str]) -> Optional[models.ModelVersion]:
    if not version_tag:
        return None
    return (
        db.query(models.ModelVersion)
        .filter(models.ModelVersion.version_tag == version_tag)
        .first()
    )


def _latest_matching(db: Session, predicate) -> Optional[models.ModelVersion]:
    for mv in (
        db.query(models.ModelVersion)
        .order_by(models.ModelVersion.training_date.desc().nullslast())
        .all()
    ):
        if predicate(mv):
            return mv
    return None


def _default_models_dir() -> Path:
    cwd_models = Path.cwd() / "models"
    if cwd_models.exists():
        return cwd_models
    return Path(__file__).resolve().parents[1] / "models"


def main() -> int:
    parser = argparse.ArgumentParser(description="Prune model versions to a minimal set.")
    parser.add_argument(
        "--keep-catboost-tag",
        help="Exact version_tag to keep for CatBoost model (optional).",
    )
    parser.add_argument(
        "--keep-deep-tag",
        help="Exact version_tag to keep for Deep Learning model (optional).",
    )
    parser.add_argument(
        "--models-dir",
        default=str(_default_models_dir()),
        help="Model artifacts directory (default: ./models).",
    )
    parser.add_argument(
        "--delete-folders",
        action="store_true",
        help="Also delete removed model folders from models dir.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes. Without this flag, script runs in dry-run mode.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        versions = (
            db.query(models.ModelVersion)
            .order_by(models.ModelVersion.training_date.desc().nullslast())
            .all()
        )
        if not versions:
            print("No model_versions found.")
            return 0

        chosen_catboost = _pick_by_tag(db, args.keep_catboost_tag)
        if not chosen_catboost:
            prod = crud.get_production_model_version(db)
            if prod and _is_catboost(prod):
                chosen_catboost = prod
            else:
                chosen_catboost = _latest_matching(db, _is_catboost)

        chosen_deep = _pick_by_tag(db, args.keep_deep_tag)
        if not chosen_deep:
            chosen_deep = _latest_matching(db, _is_deep_learning)

        keep_ids = set()
        if chosen_catboost:
            keep_ids.add(chosen_catboost.model_version_id)
        if chosen_deep:
            keep_ids.add(chosen_deep.model_version_id)

        if not keep_ids:
            print("No CatBoost/Deep Learning candidates found. Aborting.")
            return 1

        print("Selected keep set:")
        if chosen_catboost:
            print(f"- CatBoost: {chosen_catboost.version_tag} (id={chosen_catboost.model_version_id})")
        else:
            print("- CatBoost: none found")
        if chosen_deep:
            print(f"- Deep Learning: {chosen_deep.version_tag} (id={chosen_deep.model_version_id})")
        else:
            print("- Deep Learning: none found")

        to_remove = [mv for mv in versions if mv.model_version_id not in keep_ids]
        if not to_remove:
            print("\nNothing to prune; only selected models exist.")
            return 0

        print("\nWill remove:")
        for mv in to_remove:
            print(f"- {mv.version_tag} (id={mv.model_version_id}, production={bool(mv.is_production)})")

        if not args.apply:
            print("\nDry-run only. Re-run with --apply to execute.")
            return 0

        if chosen_catboost and not chosen_catboost.is_production:
            crud.set_production_model(db, chosen_catboost.model_version_id)
            print(f"\nSet production model: {chosen_catboost.version_tag}")

        models_dir = Path(args.models_dir)
        removed_count = 0
        removed_predictions = 0
        removed_runs = 0

        for mv in to_remove:
            pred_deleted = (
                db.query(models.ModelPrediction)
                .filter(models.ModelPrediction.model_version_id == mv.model_version_id)
                .delete(synchronize_session=False)
            )
            run_deleted = (
                db.query(models.TrainingRun)
                .filter(models.TrainingRun.model_version_id == mv.model_version_id)
                .delete(synchronize_session=False)
            )
            db.delete(mv)
            db.commit()

            removed_count += 1
            removed_predictions += int(pred_deleted or 0)
            removed_runs += int(run_deleted or 0)
            print(f"Removed DB model version: {mv.version_tag}")

            if args.delete_folders:
                folder = models_dir / mv.version_tag
                if folder.exists() and folder.is_dir():
                    import shutil

                    shutil.rmtree(folder)
                    print(f"Removed folder: {folder}")

        print("\nPrune complete:")
        print(f"- Removed model versions: {removed_count}")
        print(f"- Removed model_predictions rows: {removed_predictions}")
        print(f"- Removed training_runs rows: {removed_runs}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

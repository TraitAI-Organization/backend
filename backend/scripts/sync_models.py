#!/usr/bin/env python
"""
Normalize model artifact folders under ./models and register them in DB.

Features:
- Auto-normalize CatBoost artifact directories into runtime-ready files.
- Register all valid model folders in model_versions table.
- Optional deduplication by model artifact fingerprint.

Usage examples:
  python -m scripts.sync_models
  python -m scripts.sync_models --set-production-if-missing
  python -m scripts.sync_models --dedupe
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app.database import crud, models
from app.database.session import SessionLocal


DEFAULT_METRICS = {
    "val_rmse": 10.0,
}


@dataclass
class FolderState:
    version_tag: str
    path: Path
    ready: bool
    reason: str = ""
    model_type: str = "catboost"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _find_first(path: Path, patterns: Iterable[str], exclude: Optional[set[str]] = None) -> Optional[Path]:
    exclude = exclude or set()
    for pattern in patterns:
        matches = sorted(path.glob(pattern))
        for match in matches:
            if match.name in exclude:
                continue
            if match.is_file():
                return match
    return None


def _copy_if_needed(src: Path, dst: Path) -> bool:
    if src.resolve() == dst.resolve():
        return False
    if dst.exists() and dst.resolve() == src.resolve():
        return False
    shutil.copy2(src, dst)
    return True


def _reference_feature_schema(models_dir: Path, current_folder: Path) -> tuple[List[str], List[str]]:
    """
    Find a usable feature schema from another model folder.
    """
    for folder in sorted([p for p in models_dir.iterdir() if p.is_dir() and p != current_folder]):
        feature_columns = folder / "feature_columns.json"
        categorical_features = folder / "categorical_features.json"
        if not feature_columns.exists() or not categorical_features.exists():
            continue
        cols = _read_json(feature_columns, [])
        cats = _read_json(categorical_features, [])
        if isinstance(cols, list) and isinstance(cats, list) and cols and cats:
            return cols, cats
    return [], []


def _load_scaler_feature_names(folder: Path) -> List[str]:
    scaler_path = folder / "numeric_scaler.pkl"
    if not scaler_path.exists():
        return []
    try:
        import joblib

        scaler = joblib.load(scaler_path)
        names = getattr(scaler, "feature_names_in_", None)
        if names is None:
            return []
        return [str(x) for x in list(names)]
    except Exception:
        return []


def _normalize_catboost_folder(folder: Path) -> bool:
    """
    Best-effort normalization for CatBoost artifact folders.
    Returns True if any file changed.
    """
    changed = False

    # Skip CatBoost normalization for deep-learning folders.
    if (folder / "model.pth").exists() or _find_first(folder, ["*.pth", "*.pt"]) or (folder / "category_sizes.json").exists():
        return changed

    model_dst = folder / "model.cbm"
    if not model_dst.exists():
        model_src = _find_first(folder, ["*.cbm"])
        if model_src:
            changed = _copy_if_needed(model_src, model_dst) or changed

    feature_columns_dst = folder / "feature_columns.json"
    if not feature_columns_dst.exists():
        feature_columns_src = _find_first(
            folder,
            ["*feature_columns*.json", "feature_columns.json"],
            exclude={"features.json", "metrics.json", "params.json"},
        )
        if feature_columns_src:
            changed = _copy_if_needed(feature_columns_src, feature_columns_dst) or changed

    categorical_dst = folder / "categorical_features.json"
    if not categorical_dst.exists():
        categorical_src = _find_first(
            folder,
            ["*categorical_features*.json", "categorical_features.json"],
            exclude={"features.json", "metrics.json", "params.json"},
        )
        if categorical_src:
            changed = _copy_if_needed(categorical_src, categorical_dst) or changed

    crop_stats_dst = folder / "crop_statistics.csv"
    if not crop_stats_dst.exists():
        crop_stats_src = _find_first(folder, ["*crop_statistics*.csv", "crop_statistics.csv"])
        if crop_stats_src:
            changed = _copy_if_needed(crop_stats_src, crop_stats_dst) or changed

    # Create features.json if missing and feature columns are available.
    features_dst = folder / "features.json"
    if not features_dst.exists() and feature_columns_dst.exists():
        feature_columns = _read_json(feature_columns_dst, [])
        categorical_features = _read_json(categorical_dst, [])
        if isinstance(feature_columns, list):
            payload = {
                "feature_names": feature_columns,
                "preprocessing": {
                    "external_model": True,
                    "external_model_type": "catboost",
                    "skip_feature_engineering": True,
                    "source": str(folder),
                    "categorical_features": categorical_features if isinstance(categorical_features, list) else [],
                    "crop_statistics_file": "crop_statistics.csv" if crop_stats_dst.exists() else None,
                    "target_standardization": "crop_zscore" if crop_stats_dst.exists() else None,
                    "input_aliases": {"crop": "crop_name_en", "variety": "variety_name_en"},
                    "notes": "Auto-normalized by sync_models.py",
                },
            }
            features_dst.write_text(json.dumps(payload, indent=2))
            changed = True

    metrics_dst = folder / "metrics.json"
    if not metrics_dst.exists():
        metrics_dst.write_text(json.dumps(DEFAULT_METRICS, indent=2))
        changed = True

    params_dst = folder / "params.json"
    if not params_dst.exists():
        params_dst.write_text(
            json.dumps(
                {
                    "model_type": "catboost",
                    "source": "auto_sync",
                    "notes": "Auto-generated params placeholder by sync_models.py",
                },
                indent=2,
            )
        )
        changed = True

    return changed


def _normalize_deep_learning_folder(folder: Path, models_dir: Path) -> bool:
    """
    Best-effort normalization for deep learning artifact folders.
    Returns True if any file changed.
    """
    changed = False

    model_pth_dst = folder / "model.pth"
    if not model_pth_dst.exists():
        model_pth_src = _find_first(folder, ["*.pth", "*.pt"], exclude={"model.pth"})
        if model_pth_src:
            changed = _copy_if_needed(model_pth_src, model_pth_dst) or changed

    # Not a deep learning candidate.
    if not model_pth_dst.exists() and not (folder / "category_sizes.json").exists():
        return changed

    reference_features, reference_cats = _reference_feature_schema(models_dir, folder)
    category_sizes = _read_json(folder / "category_sizes.json", [])
    if not isinstance(category_sizes, list):
        category_sizes = []
    category_sizes = [int(x) for x in category_sizes if isinstance(x, (int, float))]

    cat_features = _read_json(folder / "categorical_features.json", [])
    if not isinstance(cat_features, list):
        cat_features = []
    if not cat_features:
        cat_features = reference_cats
    if category_sizes and len(cat_features) != len(category_sizes):
        if len(reference_cats) == len(category_sizes):
            cat_features = reference_cats
        else:
            cat_features = [f"cat_feature_{i+1}" for i in range(len(category_sizes))]

    numeric_features = _load_scaler_feature_names(folder)
    if not numeric_features and reference_features:
        cat_set = set(cat_features)
        numeric_features = [f for f in reference_features if f not in cat_set]

    features_dst = folder / "features.json"
    features_payload = _read_json(features_dst, {}) if features_dst.exists() else {}
    if not isinstance(features_payload, dict):
        features_payload = {}

    existing_features = features_payload.get("feature_names", [])
    if not isinstance(existing_features, list):
        existing_features = []
    if not existing_features:
        existing_features = cat_features + [f for f in numeric_features if f not in set(cat_features)]

    preprocessing = features_payload.get("preprocessing", {})
    if not isinstance(preprocessing, dict):
        preprocessing = {}

    preprocessing.setdefault("external_model", True)
    preprocessing.setdefault("external_model_type", "deep_learning_pytorch")
    preprocessing.setdefault("skip_feature_engineering", True)
    preprocessing.setdefault("input_aliases", {"crop": "crop_name_en", "variety": "variety_name_en"})
    preprocessing.setdefault("categorical_features", cat_features)
    preprocessing.setdefault("category_sizes", category_sizes)
    preprocessing.setdefault("numeric_features", numeric_features)
    preprocessing.setdefault("numeric_scaler_file", "numeric_scaler.pkl")
    preprocessing.setdefault("category_sizes_file", "category_sizes.json")
    preprocessing.setdefault("categorical_encoding", "stable_hash_mod")
    preprocessing.setdefault("notes", "Auto-normalized deep learning artifacts by sync_models.py")

    normalized_features_payload = {
        "feature_names": existing_features,
        "preprocessing": preprocessing,
    }
    serialized = json.dumps(normalized_features_payload, indent=2)
    if not features_dst.exists() or features_dst.read_text() != serialized:
        features_dst.write_text(serialized)
        changed = True

    # Deep model predicts standardized target; copy crop stats from any available model if missing.
    crop_stats_dst = folder / "crop_statistics.csv"
    if not crop_stats_dst.exists():
        for candidate in sorted(models_dir.glob("*/crop_statistics*.csv")):
            if candidate.parent == folder:
                continue
            changed = _copy_if_needed(candidate, crop_stats_dst) or changed
            break
    if crop_stats_dst.exists():
        preprocessing["crop_statistics_file"] = "crop_statistics.csv"
        preprocessing.setdefault("target_standardization", "crop_zscore")
        serialized = json.dumps({"feature_names": existing_features, "preprocessing": preprocessing}, indent=2)
        if features_dst.read_text() != serialized:
            features_dst.write_text(serialized)
            changed = True

    metrics_dst = folder / "metrics.json"
    if not metrics_dst.exists():
        metrics_dst.write_text(json.dumps(DEFAULT_METRICS, indent=2))
        changed = True

    params_dst = folder / "params.json"
    params_payload = _read_json(params_dst, {})
    if not isinstance(params_payload, dict):
        params_payload = {}
    # Force explicit DL model typing for .pth runtime folders.
    params_payload["model_type"] = "deep_learning_pytorch"
    params_payload["artifact_file"] = "model.pth"
    params_payload.setdefault("source", "auto_sync")
    params_payload.setdefault("notes", "Auto-generated params placeholder by sync_models.py")
    params_serialized = json.dumps(params_payload, indent=2)
    if not params_dst.exists() or params_dst.read_text() != params_serialized:
        params_dst.write_text(params_serialized)
        changed = True

    return changed


def _folder_state(folder: Path) -> FolderState:
    version_tag = folder.name
    if not folder.is_dir():
        return FolderState(version_tag=version_tag, path=folder, ready=False, reason="not a directory")

    has_model = (
        (folder / "model.cbm").exists()
        or (folder / "model.pkl").exists()
        or (folder / "model.pth").exists()
    )
    has_meta = all((folder / name).exists() for name in ["features.json", "metrics.json", "params.json"])

    if has_model and has_meta:
        params = _read_json(folder / "params.json", {})
        default_model_type = "deep_learning_pytorch" if (folder / "model.pth").exists() else "catboost"
        model_type = params.get("model_type", default_model_type) if isinstance(params, dict) else default_model_type
        if (folder / "model.pth").exists() and model_type in {"catboost", "", None}:
            model_type = "deep_learning_pytorch"
        return FolderState(version_tag=version_tag, path=folder, ready=True, model_type=model_type)

    return FolderState(
        version_tag=version_tag,
        path=folder,
        ready=False,
        reason="missing required runtime artifacts (model.[cbm|pkl|pth], features.json, metrics.json, params.json)",
    )


def _register_folder(db: Session, state: FolderState) -> str:
    folder = state.path
    features_payload = _read_json(folder / "features.json", {})
    metrics_payload = _read_json(folder / "metrics.json", {})
    params_payload = _read_json(folder / "params.json", {})

    feature_list = features_payload.get("feature_names", []) if isinstance(features_payload, dict) else []
    preprocessing_steps = features_payload.get("preprocessing", {}) if isinstance(features_payload, dict) else {}
    numeric_metrics: Dict[str, float] = {}
    if isinstance(metrics_payload, dict):
        for k, v in metrics_payload.items():
            if isinstance(v, (int, float)):
                numeric_metrics[k] = float(v)

    existing = (
        db.query(models.ModelVersion)
        .filter(models.ModelVersion.version_tag == state.version_tag)
        .first()
    )
    if existing:
        updated = False
        if existing.model_type != (state.model_type or existing.model_type):
            existing.model_type = state.model_type or existing.model_type
            updated = True

        normalized_params = params_payload if isinstance(params_payload, dict) else {}
        normalized_features = feature_list if isinstance(feature_list, list) else []
        normalized_preprocessing = preprocessing_steps if isinstance(preprocessing_steps, dict) else {}
        normalized_metrics = numeric_metrics or DEFAULT_METRICS

        if existing.model_params != normalized_params:
            existing.model_params = normalized_params
            updated = True
        if existing.feature_list != normalized_features:
            existing.feature_list = normalized_features
            updated = True
        if existing.preprocessing_steps != normalized_preprocessing:
            existing.preprocessing_steps = normalized_preprocessing
            updated = True
        if existing.performance_metrics != normalized_metrics:
            existing.performance_metrics = normalized_metrics
            updated = True

        if updated:
            db.commit()
            db.refresh(existing)
            return f"updated id={existing.model_version_id}"
        return f"exists id={existing.model_version_id}"

    db_model = models.ModelVersion(
        version_tag=state.version_tag,
        model_type=state.model_type or "catboost",
        model_params=params_payload if isinstance(params_payload, dict) else {},
        training_data_range={"source": "sync_models"},
        performance_metrics=numeric_metrics or DEFAULT_METRICS,
        feature_list=feature_list if isinstance(feature_list, list) else [],
        preprocessing_steps=preprocessing_steps if isinstance(preprocessing_steps, dict) else {},
        notes="Registered by sync_models.py",
        created_by="sync_models_script",
        is_production=False,
    )
    db.add(db_model)
    db.commit()
    db.refresh(db_model)
    return f"registered id={db_model.model_version_id}"


def _fingerprint(state: FolderState) -> Optional[str]:
    if not state.ready:
        return None
    folder = state.path
    model_file = folder / "model.pkl"
    if not model_file.exists():
        model_file = folder / "model.cbm"
    if not model_file.exists():
        model_file = folder / "model.pth"
    if not model_file.exists():
        return None

    features = folder / "features.json"
    if not features.exists():
        return None

    h = hashlib.sha256()
    h.update(_sha256_file(model_file).encode())
    h.update(_sha256_file(features).encode())
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync model folders to DB registry")
    parser.add_argument(
        "--models-dir",
        default="models",
        help="Path to models directory (default: models)",
    )
    parser.add_argument(
        "--set-production-if-missing",
        action="store_true",
        help="Set production model to latest registered if none is set",
    )
    parser.add_argument(
        "--dedupe",
        action="store_true",
        help="Delete duplicate folders/DB rows by model fingerprint (keeps one version)",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    models_dir = (repo_root / args.models_dir).resolve() if not Path(args.models_dir).is_absolute() else Path(args.models_dir)
    if not models_dir.exists():
        raise FileNotFoundError(f"Models directory not found: {models_dir}")

    db: Session = SessionLocal()
    try:
        folders = sorted([p for p in models_dir.iterdir() if p.is_dir() and not p.name.startswith(".")])
        print(f"Scanning model folders under: {models_dir}")

        states: List[FolderState] = []
        for folder in folders:
            changed = _normalize_catboost_folder(folder)
            changed = _normalize_deep_learning_folder(folder, models_dir) or changed
            if changed:
                print(f"[normalized] {folder.name}")
            state = _folder_state(folder)
            states.append(state)

        ready = [s for s in states if s.ready]
        skipped = [s for s in states if not s.ready]

        for s in ready:
            result = _register_folder(db, s)
            print(f"[{s.version_tag}] {result}")

        if skipped:
            print("\nSkipped folders:")
            for s in skipped:
                print(f"- {s.version_tag}: {s.reason}")

        if args.set_production_if_missing:
            production = crud.get_production_model_version(db)
            if production:
                print(f"\nProduction already set: {production.version_tag}")
            else:
                candidate = (
                    db.query(models.ModelVersion)
                    .order_by(models.ModelVersion.training_date.desc())
                    .first()
                )
                if candidate:
                    crud.set_production_model(db, candidate.model_version_id)
                    print(f"\nSet production model: {candidate.version_tag}")
                else:
                    print("\nNo model versions available to set production.")

        if args.dedupe:
            print("\nChecking duplicate model folders by fingerprint...")
            production = crud.get_production_model_version(db)
            production_tag = production.version_tag if production else None

            fp_map: Dict[str, List[FolderState]] = {}
            for s in ready:
                fp = _fingerprint(s)
                if fp:
                    fp_map.setdefault(fp, []).append(s)

            for group in fp_map.values():
                if len(group) < 2:
                    continue

                group_sorted = sorted(group, key=lambda s: s.version_tag)
                keeper = group_sorted[0]
                for s in group_sorted:
                    if s.version_tag == production_tag:
                        keeper = s
                        break

                print(f"Duplicate group keeper: {keeper.version_tag}")
                for dup in group_sorted:
                    if dup.version_tag == keeper.version_tag:
                        continue
                    if dup.version_tag == production_tag:
                        print(f"  - keep production version: {dup.version_tag}")
                        continue

                    db_row = (
                        db.query(models.ModelVersion)
                        .filter(models.ModelVersion.version_tag == dup.version_tag)
                        .first()
                    )
                    if db_row:
                        db.delete(db_row)
                        db.commit()
                        print(f"  - removed DB row: {dup.version_tag}")

                    if dup.path.exists():
                        shutil.rmtree(dup.path)
                        print(f"  - removed folder: {dup.path}")

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

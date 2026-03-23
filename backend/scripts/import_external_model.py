#!/usr/bin/env python
"""
Import external model artifacts into the platform model directory.

Example:
  python scripts/import_external_model.py \
    --source-dir ../model_specific_files/CBModel_v2 \
    --version-tag genmills_cbmodel_v2
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def find_one(source: Path, pattern: str) -> Path:
    matches = list(source.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No file matching pattern '{pattern}' under {source}")
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="Import external model artifacts")
    parser.add_argument("--source-dir", required=True, help="Directory containing source artifacts")
    parser.add_argument(
        "--version-tag",
        default="genmills_cbmodel_v2",
        help="Target model version folder name under ./models",
    )
    parser.add_argument(
        "--report-file",
        default="",
        help="Optional path to modelling report file (.docx) to copy into model folder",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    source = (repo_root / args.source_dir).resolve() if not Path(args.source_dir).is_absolute() else Path(args.source_dir)
    target = repo_root / "models" / args.version_tag
    target.mkdir(parents=True, exist_ok=True)

    model_file = find_one(source, "*.cbm")
    feature_columns_file = find_one(source, "*feature_columns*.json")
    categorical_features_file = find_one(source, "*categorical_features*.json")
    crop_stats_file = find_one(source, "*crop_statistics*.csv")

    shutil.copy2(model_file, target / "model.cbm")
    shutil.copy2(feature_columns_file, target / "feature_columns.json")
    shutil.copy2(categorical_features_file, target / "categorical_features.json")
    shutil.copy2(crop_stats_file, target / "crop_statistics.csv")

    feature_columns = json.loads((target / "feature_columns.json").read_text())
    categorical_features = json.loads((target / "categorical_features.json").read_text())

    (target / "features.json").write_text(
        json.dumps(
            {
                "feature_names": feature_columns,
                "preprocessing": {
                    "external_model": True,
                    "external_model_type": "catboost",
                    "skip_feature_engineering": True,
                    "source": str(source),
                    "categorical_features": categorical_features,
                    "crop_statistics_file": "crop_statistics.csv",
                    "target_standardization": "crop_zscore",
                    "input_aliases": {
                        "crop": "crop_name_en",
                        "variety": "variety_name_en",
                    },
                    "notes": "Imported external GenMills CatBoost artifacts",
                },
            },
            indent=2,
        )
    )

    (target / "metrics.json").write_text(
        json.dumps(
            {
                "random_cv_r2_5fold": 0.81,
                "random_cv_r2_20fold": 0.85,
                "grouped_county_cv_r2": 0.07,
                "grouped_crop_cv_r2": 0.017,
                "leave_one_crop_out_r2": 0.17,
                "leave_one_county_out_r2": 0.07,
                "val_rmse": 10.0,
            },
            indent=2,
        )
    )

    (target / "params.json").write_text(
        json.dumps(
            {
                "model_type": "catboost",
                "loss_function": "RMSE",
                "iterations": 5000,
                "learning_rate": 0.03,
                "depth": 10,
                "l2_leaf_reg": 8,
                "early_stopping_rounds": 200,
                "source": "GenMills modelling report",
            },
            indent=2,
        )
    )

    if args.report_file:
        report_path = (repo_root / args.report_file).resolve() if not Path(args.report_file).is_absolute() else Path(args.report_file)
        if report_path.exists():
            shutil.copy2(report_path, target / report_path.name)

    print(f"Imported external model artifacts to: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

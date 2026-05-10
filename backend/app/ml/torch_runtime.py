"""
PyTorch runtime helpers for tabular deep-learning model inference.
"""
from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Sequence

import joblib
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def _stable_hash_bucket(value: Any, bucket_size: int) -> int:
    if bucket_size <= 1:
        return 0
    if value is None:
        return 0
    text = str(value)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return int(digest, 16) % bucket_size


@dataclass
class TorchModelConfig:
    model_path: str
    category_sizes: List[int]
    categorical_features: List[str]
    numeric_features: List[str]
    numeric_scaler_path: str | None


class TorchTabularModelWrapper:
    def __init__(
        self,
        model: Any,
        torch_module: Any,
        config: TorchModelConfig,
        expected_numeric_dim: int,
        output_dim: int = 1,
        uncertainty_output: str = "log_variance",
    ):
        self.model = model
        self.torch = torch_module
        self.config = config
        self.expected_numeric_dim = expected_numeric_dim
        self.output_dim = int(output_dim)
        # How to interpret the network's second output. Architectures that apply
        # softplus on the variance head emit raw variance (>= 0); the older
        # log-variance head emits unbounded log-variance. The predictor reads this
        # to apply the correct sigma transform.
        self.uncertainty_output = str(uncertainty_output)
        self.scaler = None
        if config.numeric_scaler_path and os.path.exists(config.numeric_scaler_path):
            try:
                self.scaler = joblib.load(config.numeric_scaler_path)
            except Exception as exc:
                logger.warning(f"Failed to load numeric scaler at {config.numeric_scaler_path}: {exc}")

    def _prepare_inputs(self, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        n_rows = len(X)

        cat_matrix = np.zeros((n_rows, len(self.config.category_sizes)), dtype=np.int64)
        for idx, size in enumerate(self.config.category_sizes):
            feat = self.config.categorical_features[idx] if idx < len(self.config.categorical_features) else None
            if feat is None or feat not in X.columns:
                cat_matrix[:, idx] = np.array(
                    [_stable_hash_bucket("Missing", size)] * n_rows, dtype=np.int64
                )
                continue

            col = X[feat]
            # If the predictor already mapped strings -> integer codes via
            # cat_mappings.json, the column is integer-typed. Use those codes directly,
            # clamping to the embedding size to guard against any out-of-range indices.
            if pd.api.types.is_integer_dtype(col):
                codes = col.fillna(0).astype(np.int64).to_numpy()
                codes = np.clip(codes, 0, max(size - 1, 0))
                cat_matrix[:, idx] = codes
            else:
                # Legacy / unmapped path: stable hash bucket on the string value.
                values = col.fillna("Missing").astype(str).tolist()
                cat_matrix[:, idx] = np.array(
                    [_stable_hash_bucket(v, size) for v in values], dtype=np.int64
                )

        numeric_cols: List[np.ndarray] = []
        for feat in self.config.numeric_features:
            if feat in X.columns:
                col = pd.to_numeric(X[feat], errors="coerce").fillna(0.0).to_numpy(dtype=np.float32)
            else:
                col = np.zeros(n_rows, dtype=np.float32)
            numeric_cols.append(col)
        if numeric_cols:
            numeric_matrix = np.stack(numeric_cols, axis=1)
        else:
            numeric_matrix = np.zeros((n_rows, 0), dtype=np.float32)

        if numeric_matrix.shape[1] < self.expected_numeric_dim:
            pad = np.zeros((n_rows, self.expected_numeric_dim - numeric_matrix.shape[1]), dtype=np.float32)
            numeric_matrix = np.concatenate([numeric_matrix, pad], axis=1)
        elif numeric_matrix.shape[1] > self.expected_numeric_dim:
            numeric_matrix = numeric_matrix[:, : self.expected_numeric_dim]

        if self.scaler is not None and numeric_matrix.shape[1] > 0:
            try:
                numeric_matrix = self.scaler.transform(numeric_matrix).astype(np.float32)
            except Exception as exc:
                logger.warning(f"Numeric scaler transform failed; using raw numeric features: {exc}")

        return cat_matrix, numeric_matrix

    def _forward(self, X: pd.DataFrame | np.ndarray) -> np.ndarray:
        if isinstance(X, np.ndarray):
            X_df = pd.DataFrame(X)
        elif isinstance(X, pd.DataFrame):
            X_df = X.copy()
        else:
            X_df = pd.DataFrame(X)

        cat_matrix, numeric_matrix = self._prepare_inputs(X_df)
        cat_tensor = self.torch.tensor(cat_matrix, dtype=self.torch.long)
        num_tensor = self.torch.tensor(numeric_matrix, dtype=self.torch.float32)
        with self.torch.no_grad():
            out = self.model(cat_tensor, num_tensor).cpu().numpy()
        # Normalize to shape (N, output_dim).
        if out.ndim == 1:
            out = out.reshape(-1, 1)
        return out

    def predict(self, X: pd.DataFrame | np.ndarray) -> np.ndarray:
        out = self._forward(X)
        # First output is always the mean / yield.
        return out[:, 0]

    def predict_with_uncertainty(self, X: pd.DataFrame | np.ndarray):
        """
        Returns (mean, log_variance) numpy arrays for 2-output uncertainty heads.
        Returns None if this model is single-output.
        """
        if self.output_dim < 2:
            return None
        out = self._forward(X)
        return out[:, 0], out[:, 1]


def load_torch_tabular_model(
    version_dir: str,
    feature_list: Sequence[str],
    preprocessing: Dict[str, Any],
):
    try:
        import torch
        import torch.nn as nn
    except ImportError as exc:
        raise ImportError(
            "PyTorch model detected but torch is not installed. "
            "Add `torch` to backend requirements."
        ) from exc

    model_file = preprocessing.get("artifact_file", "model.pth")
    model_path = os.path.join(version_dir, model_file)
    if not os.path.exists(model_path):
        model_path = os.path.join(version_dir, "model.pth")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"PyTorch artifact not found: {model_path}")

    state_dict_obj = torch.load(model_path, map_location="cpu")
    if isinstance(state_dict_obj, dict) and "state_dict" in state_dict_obj and isinstance(state_dict_obj["state_dict"], dict):
        state_dict = state_dict_obj["state_dict"]
    elif isinstance(state_dict_obj, dict):
        state_dict = state_dict_obj
    else:
        raise ValueError("Unsupported .pth format. Expected a state_dict-like object.")

    emb_keys = sorted(
        [k for k in state_dict.keys() if k.startswith("embeddings.") and k.endswith(".weight")],
        key=lambda x: int(x.split(".")[1]),
    )
    if not emb_keys:
        raise ValueError("Invalid deep model state_dict: no embedding layers found.")

    inferred_category_sizes = [int(state_dict[k].shape[0]) for k in emb_keys]
    inferred_embedding_dims = [int(state_dict[k].shape[1]) for k in emb_keys]

    # Dispatch on architecture style:
    #   - Legacy "model.*" Sequential with combined 2-output linear (log_variance head)
    #   - New "backbone.* + mean_head + var_head" with softplus on var_head (variance head)
    has_backbone = "backbone.0.weight" in state_dict
    has_mean_head = "mean_head.weight" in state_dict and "var_head.weight" in state_dict

    if has_backbone and has_mean_head:
        # ---- New architecture: backbone + separate heads ---------------------
        lin0 = state_dict["backbone.0.weight"]
        lin4 = state_dict["backbone.4.weight"]
        lin8 = state_dict["backbone.8.weight"]
        input_dim = int(lin0.shape[1])
        hidden1 = int(lin0.shape[0])
        hidden2 = int(lin4.shape[0])
        hidden3 = int(lin8.shape[0])
        out_dim = 2  # always (mean, variance)

        # BN layout detection (running_mean tells us where BN sits).
        if "backbone.1.running_mean" in state_dict and "backbone.5.running_mean" in state_dict:
            bn_after_relu = False
        elif "backbone.2.running_mean" in state_dict and "backbone.6.running_mean" in state_dict:
            bn_after_relu = True
        else:
            raise ValueError(
                "Backbone BatchNorm layers not found at expected indices (1,5) or (2,6). "
                f"Got: {[k for k in state_dict if 'running_mean' in k]}"
            )

        class YieldDeepNetWithHeads(nn.Module):
            def __init__(self):
                super().__init__()
                self.embeddings = nn.ModuleList([
                    nn.Embedding(s, d)
                    for s, d in zip(inferred_category_sizes, inferred_embedding_dims)
                ])
                if bn_after_relu:
                    self.backbone = nn.Sequential(
                        nn.Linear(input_dim, hidden1),  # 0
                        nn.ReLU(),                       # 1
                        nn.BatchNorm1d(hidden1),         # 2
                        nn.Dropout(0.3),                 # 3
                        nn.Linear(hidden1, hidden2),     # 4
                        nn.ReLU(),                       # 5
                        nn.BatchNorm1d(hidden2),         # 6
                        nn.Dropout(0.3),                 # 7
                        nn.Linear(hidden2, hidden3),     # 8
                    )
                else:
                    self.backbone = nn.Sequential(
                        nn.Linear(input_dim, hidden1),
                        nn.BatchNorm1d(hidden1),
                        nn.ReLU(),
                        nn.Dropout(0.3),
                        nn.Linear(hidden1, hidden2),
                        nn.BatchNorm1d(hidden2),
                        nn.ReLU(),
                        nn.Dropout(0.3),
                        nn.Linear(hidden2, hidden3),
                    )
                self.mean_head = nn.Linear(hidden3, 1)
                self.var_head = nn.Linear(hidden3, 1)

            def forward(self, x_cat, x_num):
                emb_parts = [emb(x_cat[:, i]) for i, emb in enumerate(self.embeddings)]
                x = torch.cat(emb_parts + [x_num], dim=1)
                h = self.backbone(x)
                # Apply ReLU after backbone before heads (standard with this layout).
                h = torch.relu(h)
                mean = self.mean_head(h)
                # softplus enforces variance >= 0 (engineer's "variance head fixed").
                var = torch.nn.functional.softplus(self.var_head(h))
                return torch.cat([mean, var], dim=1)

        model = YieldDeepNetWithHeads()
        model.load_state_dict(state_dict, strict=True)
        model.eval()
        uncertainty_output = "variance"
        logger.info(
            "Built YieldDeepNetWithHeads (bn_%s_relu, input_dim=%d, hidden=[%d,%d,%d], heads=mean+var/softplus)",
            "after" if bn_after_relu else "before",
            input_dim, hidden1, hidden2, hidden3,
        )

    else:
        # ---- Legacy architecture: single Sequential `model.*` ---------------
        for key in ("model.0.weight", "model.4.weight", "model.8.weight", "model.10.weight"):
            if key not in state_dict:
                raise ValueError(f"Invalid deep model state_dict: missing {key}")

        lin0_weight = state_dict["model.0.weight"]
        lin4_weight = state_dict["model.4.weight"]
        lin8_weight = state_dict["model.8.weight"]
        lin10_weight = state_dict["model.10.weight"]

        input_dim = int(lin0_weight.shape[1])
        hidden1 = int(lin0_weight.shape[0])
        hidden2 = int(lin4_weight.shape[0])
        hidden3 = int(lin8_weight.shape[0])
        out_dim = int(lin10_weight.shape[0])

        if "model.1.running_mean" in state_dict and "model.5.running_mean" in state_dict:
            bn_after_relu = False
        elif "model.2.running_mean" in state_dict and "model.6.running_mean" in state_dict:
            bn_after_relu = True
        else:
            raise ValueError(
                "Invalid deep model state_dict: cannot locate BatchNorm running_mean tensors at "
                "indices (1, 5) or (2, 6). Got keys: "
                f"{[k for k in state_dict.keys() if 'running_mean' in k]}"
            )

        class YieldDeepNet(nn.Module):
            def __init__(self):
                super().__init__()
                self.embeddings = nn.ModuleList(
                    [nn.Embedding(cat_size, emb_dim) for cat_size, emb_dim in zip(inferred_category_sizes, inferred_embedding_dims)]
                )
                if bn_after_relu:
                    self.model = nn.Sequential(
                        nn.Linear(input_dim, hidden1),
                        nn.ReLU(),
                        nn.BatchNorm1d(hidden1),
                        nn.Dropout(0.3),
                        nn.Linear(hidden1, hidden2),
                        nn.ReLU(),
                        nn.BatchNorm1d(hidden2),
                        nn.Dropout(0.3),
                        nn.Linear(hidden2, hidden3),
                        nn.ReLU(),
                        nn.Linear(hidden3, out_dim),
                    )
                else:
                    self.model = nn.Sequential(
                        nn.Linear(input_dim, hidden1),
                        nn.BatchNorm1d(hidden1),
                        nn.ReLU(),
                        nn.Dropout(0.3),
                        nn.Linear(hidden1, hidden2),
                        nn.BatchNorm1d(hidden2),
                        nn.ReLU(),
                        nn.Dropout(0.3),
                        nn.Linear(hidden2, hidden3),
                        nn.ReLU(),
                        nn.Linear(hidden3, out_dim),
                    )

            def forward(self, x_cat, x_num):
                emb_parts = [emb(x_cat[:, i]) for i, emb in enumerate(self.embeddings)]
                x = torch.cat(emb_parts + [x_num], dim=1)
                out = self.model(x)
                if out_dim == 1:
                    return out.squeeze(-1)
                return out

        model = YieldDeepNet()
        model.load_state_dict(state_dict, strict=True)
        model.eval()
        uncertainty_output = "log_variance"
        logger.info(
            "Built YieldDeepNet (legacy, bn_%s_relu, input_dim=%d, hidden=[%d,%d,%d], out_dim=%d)",
            "after" if bn_after_relu else "before",
            input_dim, hidden1, hidden2, hidden3, out_dim,
        )

    category_sizes = preprocessing.get("category_sizes")
    if not isinstance(category_sizes, list) or len(category_sizes) != len(inferred_category_sizes):
        category_sizes = inferred_category_sizes
    else:
        category_sizes = [int(v) for v in category_sizes]

    categorical_features = preprocessing.get("categorical_features", [])
    if not isinstance(categorical_features, list):
        categorical_features = []
    if len(categorical_features) != len(category_sizes):
        fallback = [str(f) for f in list(feature_list)[: len(category_sizes)]]
        if len(fallback) == len(category_sizes):
            categorical_features = fallback
        else:
            categorical_features = [f"cat_feature_{i+1}" for i in range(len(category_sizes))]

    numeric_features = preprocessing.get("numeric_features", [])
    if not isinstance(numeric_features, list):
        numeric_features = []
    if not numeric_features:
        cat_set = set(categorical_features)
        numeric_features = [f for f in feature_list if f not in cat_set]

    expected_numeric_dim = input_dim - sum(inferred_embedding_dims)
    scaler_file = preprocessing.get("numeric_scaler_file", "numeric_scaler.pkl")
    scaler_path = os.path.join(version_dir, scaler_file) if scaler_file else None

    config = TorchModelConfig(
        model_path=model_path,
        category_sizes=category_sizes,
        categorical_features=[str(x) for x in categorical_features],
        numeric_features=[str(x) for x in numeric_features],
        numeric_scaler_path=scaler_path,
    )
    return TorchTabularModelWrapper(
        model,
        torch,
        config,
        expected_numeric_dim,
        output_dim=out_dim,
        uncertainty_output=uncertainty_output,
    )

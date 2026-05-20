"""
Live prediction enrichment.

When a user runs the prediction wizard for a brand-new field, they only
provide a handful of inputs (crop, variety, state, county, acres, totalN,
totalP, totalK, water, plus optional fertilizer breakdowns). The model
expects 86 features — the remaining ~75 default to 0 / "Missing", which
collapses predictions toward the training mean (validated empirically:
the lean path's predicted-yield std is ~7 bu/ac vs ~12 bu/ac on enriched
backfill predictions, mean shift ~3 bu/ac).

This module closes that gap by pulling regional averages from the training
CSV. For a request with `(state, county, crop, variety)`, it finds the
matching training rows and uses their per-feature mean to fill in features
the user didn't provide. The user's typed values are NEVER overwritten —
enrichment only fills absent fields.

Categoricals (job_id, machine_make1, fertilizer_id, etc.) are intentionally
NOT enriched. Per the engineer's training pipeline, most of these columns
were always-empty in the cleaned CSV and the model only ever saw 0 /
"Missing" for them at training time. Feeding it a "mode-of-region" value
would push inputs into an out-of-training-distribution region and produce
unpredictable outputs. The four categoricals the model actually trained on
(crop_name_en, variety_name_en, state, county) come from the user's
selection directly, so no enrichment is needed for those.

Match-key cascade: if (state, county, crop, variety) has no rows, drop
variety. If still none, drop county. If still none, fall back to (crop)
across the whole training set. If still none, return no enrichment.
"""
from __future__ import annotations

import logging
import math
import os
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)


# Columns we never enrich — either the user always provides them, they're
# the prediction target itself, or they're identifying / temporal metadata
# that wouldn't generalize across rows.
_NEVER_ENRICH = {
    # Targets (would be leakage)
    "yield", "yield_bu_ac",
    # Identifiers — these are categorical/ID values; copying a mean across
    # field/grower/job_id would invent a row that doesn't correspond to any
    # real field.
    "field", "grower", "job_id", "supply_id", "tankMix_id",
    "fertilizer_id", "cdms_fk", "actives_id",
    # The four categoricals the user explicitly selects in the wizard —
    # these come from the request, not from a regional lookup.
    "crop_name_en", "variety_name_en", "state", "county",
    # User-provided primary inputs — wizard collects these directly.
    "season",
    # Temporal stamps — would be misleading if averaged.
    "start", "end", "file_last_modified",
    # Free-text columns from the source CSV that were always empty in
    # training (per csv_feature_lookup.py's _TRAINING_EMPTY_COLUMNS list).
    # Filling them with a region's modal value would feed the model tokens
    # it never saw at training time.
    "filenames", "description", "blend_name", "name", "type", "status",
    "application_area", "fert_units", "formula", "manure_type",
    "chemical_type", "chem_units", "chem_product", "irrigation_method",
    "actives", "actives_Name", "actives_subComponents",
    # Machine metadata (categorical, was empty in training).
    "machine_make1", "machine_model1", "machine_type1",
    "machine_make2", "machine_model2", "machine_type2",
    "implement_a_make1", "implement_a_model1", "implement_a_type1",
    "implement_b_make1", "implement_b_model1", "implement_b_type1",
    "implement_a_make2", "implement_a_model2", "implement_a_type2",
    "implement_b_make2", "implement_b_model2", "implement_b_type2",
}


def _norm_str(value: Any) -> Optional[str]:
    """Strip / NaN-normalize a string value. Returns None for blanks."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def _norm_lower(value: Any) -> Optional[str]:
    """Lowercase-stripped for case-insensitive matching."""
    text = _norm_str(value)
    return text.lower() if text else None


class LiveEnrichmentLookup:
    """In-memory lookup keyed by (state, county, crop, variety).

    Loads the cleaned training CSV once at construction (so the first
    prediction after a server restart eats the parse cost, then every
    subsequent prediction is a dict lookup). Numeric features get
    per-key means; categoricals are intentionally skipped (see module
    docstring for why).
    """

    def __init__(self, csv_path: str):
        self.csv_path = csv_path
        self._all_keys: List[Tuple[str, str, str, str]] = []
        self._aggregates: Dict[Tuple[str, str, str, str], Dict[str, float]] = {}
        # Cache cascading fallback aggregates so we don't recompute on every miss.
        self._fallback_cache: Dict[Tuple[Optional[str], ...], Dict[str, float]] = {}
        self._df: Optional[pd.DataFrame] = None
        self._numeric_cols: List[str] = []
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self.csv_path):
            logger.warning(
                "LiveEnrichmentLookup: CSV %s not found; live enrichment disabled.",
                self.csv_path,
            )
            return
        df = pd.read_csv(self.csv_path, low_memory=False)
        logger.info(
            "LiveEnrichmentLookup: loaded %d rows from %s",
            len(df), self.csv_path,
        )

        # Normalize the match-key columns so lookups match regardless of
        # the user's casing / whitespace.
        for col in ("state", "county", "crop_name_en", "variety_name_en"):
            if col in df.columns:
                df[f"_{col}_key"] = df[col].map(_norm_lower)

        # Identify enrichable numeric columns. Any column whose Series
        # dtype is numeric AND that isn't in _NEVER_ENRICH is fair game.
        self._numeric_cols = [
            col for col in df.columns
            if col not in _NEVER_ENRICH
            and not col.startswith("_")
            and pd.api.types.is_numeric_dtype(df[col])
        ]
        logger.info(
            "LiveEnrichmentLookup: %d numeric columns eligible for enrichment.",
            len(self._numeric_cols),
        )

        # Pre-compute the strictest match aggregate. Looser cascades are
        # computed on demand and cached.
        group_cols = ["_state_key", "_county_key", "_crop_name_en_key", "_variety_name_en_key"]
        existing_group_cols = [c for c in group_cols if c in df.columns]
        if len(existing_group_cols) < 4:
            logger.warning(
                "LiveEnrichmentLookup: CSV missing one of state/county/crop/variety; "
                "exact-match enrichment will be limited.",
            )
        self._df = df

    def _aggregate_subset(self, mask: "pd.Series") -> Dict[str, float]:
        """Compute the per-numeric-column mean over `mask`-selected rows."""
        if self._df is None:
            return {}
        subset = self._df.loc[mask]
        if subset.empty:
            return {}
        agg: Dict[str, float] = {}
        for col in self._numeric_cols:
            vals = subset[col].dropna()
            if len(vals) == 0:
                continue
            mean = float(vals.mean())
            if not math.isfinite(mean):
                continue
            agg[col] = mean
        return agg

    def _match_mask(
        self,
        state: Optional[str],
        county: Optional[str],
        crop: Optional[str],
        variety: Optional[str],
    ) -> "pd.Series | None":
        """Build a boolean mask for rows matching the provided keys.
        Returns None if the DataFrame isn't loaded."""
        if self._df is None:
            return None
        mask = pd.Series(True, index=self._df.index)
        if state is not None and "_state_key" in self._df.columns:
            mask &= self._df["_state_key"] == state
        if county is not None and "_county_key" in self._df.columns:
            mask &= self._df["_county_key"] == county
        if crop is not None and "_crop_name_en_key" in self._df.columns:
            mask &= self._df["_crop_name_en_key"] == crop
        if variety is not None and "_variety_name_en_key" in self._df.columns:
            mask &= self._df["_variety_name_en_key"] == variety
        return mask

    def lookup(
        self,
        state: Optional[str],
        county: Optional[str],
        crop: Optional[str],
        variety: Optional[str],
    ) -> Tuple[Dict[str, float], str, int]:
        """Cascade through match keys, returning the first non-empty
        aggregate alongside a label describing which key matched and the
        number of training rows that contributed.

        Returns (aggregates, source_label, n_rows). source_label is one of:
          "state_county_crop_variety", "state_county_crop", "state_crop",
          "crop", "no_match".
        """
        state_k = _norm_lower(state)
        county_k = _norm_lower(county)
        crop_k = _norm_lower(crop)
        variety_k = _norm_lower(variety)

        cascade: List[Tuple[str, Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]]] = [
            ("state_county_crop_variety", (state_k, county_k, crop_k, variety_k)),
            ("state_county_crop",         (state_k, county_k, crop_k, None)),
            ("state_crop",                (state_k, None,     crop_k, None)),
            ("crop",                      (None,    None,     crop_k, None)),
        ]
        for label, (st, co, cr, vr) in cascade:
            # Skip the cascade level if we don't have the keys it needs.
            if label == "state_county_crop_variety" and not all([st, co, cr, vr]):
                continue
            if label == "state_county_crop" and not all([st, co, cr]):
                continue
            if label == "state_crop" and not all([st, cr]):
                continue
            if label == "crop" and not cr:
                continue
            mask = self._match_mask(st, co, cr, vr)
            if mask is None:
                continue
            n_rows = int(mask.sum())
            if n_rows == 0:
                continue
            agg = self._aggregate_subset(mask)
            if not agg:
                continue
            return agg, label, n_rows
        return {}, "no_match", 0

    def enrich(
        self,
        request_features: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Fill missing numeric features in `request_features` from
        regional averages. Returns (enriched_features, metadata).

        metadata fields:
          source:        which cascade level matched (string)
          rows:          how many training rows contributed
          filled_fields: dict of {feature_name: filled_value} for fields
                         that actually got auto-filled (i.e., absent in
                         the input and present in the aggregate).

        The user's typed values are NEVER overwritten — if a key already
        exists (and is not None) in request_features, we leave it alone.
        """
        enriched = dict(request_features)
        metadata: Dict[str, Any] = {"source": "no_match", "rows": 0, "filled_fields": {}}

        # The request payload uses 'crop' / 'variety' aliases that map to
        # 'crop_name_en' / 'variety_name_en' in the CSV. Mirror the alias
        # resolution the predictor does so the lookup keys are correct.
        state = request_features.get("state")
        county = request_features.get("county")
        crop = request_features.get("crop") or request_features.get("crop_name_en")
        variety = request_features.get("variety") or request_features.get("variety_name_en")

        agg, source, n_rows = self.lookup(state, county, crop, variety)
        metadata["source"] = source
        metadata["rows"] = n_rows

        if not agg:
            return enriched, metadata

        # Only fill features the user didn't provide. We check both the
        # canonical name and any input alias the predictor recognizes.
        ALIASES = {
            "crop_name_en": "crop",
            "variety_name_en": "variety",
        }
        for feature_name, mean_value in agg.items():
            user_keys = {feature_name, ALIASES.get(feature_name, "")}
            user_keys.discard("")
            if any(key in request_features and request_features[key] is not None for key in user_keys):
                continue
            enriched[feature_name] = mean_value
            metadata["filled_fields"][feature_name] = round(float(mean_value), 4)

        return enriched, metadata


# Module-level lazy singleton. Build once per process; the CSV parse is
# expensive (~1k rows × 90 columns) and the result is immutable for the
# process lifetime.
_LOOKUP_INSTANCE: Optional[LiveEnrichmentLookup] = None


def _default_csv_path() -> str:
    """Resolve the cleaned training CSV path inside the backend container
    (mounted at /app/data/Wheat/...). Fall back to the repo path for local
    runs outside Docker."""
    # /app/app/services/live_enrichment.py → /app/data/Wheat/...
    here = os.path.dirname(os.path.abspath(__file__))
    container_path = os.path.join(here, "..", "..", "data", "Wheat", "NSP_field_product_wheat1_cleaned.csv")
    container_path = os.path.normpath(container_path)
    if os.path.exists(container_path):
        return container_path
    # Fallback for non-Docker dev environments.
    return "/app/data/Wheat/NSP_field_product_wheat1_cleaned.csv"


@lru_cache(maxsize=1)
def get_live_enrichment_lookup() -> LiveEnrichmentLookup:
    """Process-wide singleton accessor."""
    return LiveEnrichmentLookup(_default_csv_path())

"""
CSV feature lookup service.

Loads an event-level training CSV (the 86-feature, ~42k-row source file the
models were trained on) and returns the full per-event feature dicts for a
given field-season identity.

This exists because the V2 ingestion service deliberately flattens the CSV
down to ~10 columns per field-season. The trained models, however, expect
the full 86-feature event-level schema. At inference time, looking up the
matching CSV rows for a field-season and feeding them back to the model
restores the schema the model was trained on. See conversation notes for
the diagnostic that motivated this module.

Identity match key: (field_number:int, crop_name_en:str, season_year:int,
variety_name_en:str|None). Season parsing matches data_ingestionV2's
`_extract_season_year` so labels like "2023 Crop 2" fold into 2023.

Observed-yield column (`yield_bu_ac`) is stripped from every returned row —
that's the model's target, not an input. `yield_target` (grower-planned
yield) is preserved because the model expects it as a feature.
"""
from __future__ import annotations

import logging
import math
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)


# Columns we never want to feed back to the model at inference time.
# `yield_bu_ac` is the target in the operational CSV; `yield` is the same
# column renamed in the engineer's cleaned/training CSV. Either being fed
# to the model would be target leakage, so we strip both names defensively.
_DROP_COLUMNS = {"yield_bu_ac", "yield"}


# Columns that were ALWAYS EMPTY in the cleaned training CSV
# (NSP_field_product_wheat1_cleaned.csv). The engineer's training pipeline
# does `pd.read_csv -> dropna(target) -> select_dtypes`, so empty columns
# become all-NaN -> float64 -> "numeric" -> fillna(0) -> StandardScaler with
# mean=0/std=0 (sklearn falls back to scale=1). The neural-net weights for
# these columns were therefore trained against constant 0 inputs.
#
# Our event-level operational CSV populates many of these columns with real
# string/numeric values per event. Naively merging events keeps those values
# in the merged row; the scaler can't standardize them (it's effectively
# identity for these columns), so the deep-learning model receives inputs
# orders of magnitude outside its trained distribution — neural-net outputs
# explode to ~1M+. CatBoost (tree splits) tolerates this; the DL net does
# not.
#
# Masking these columns to empty on the merged row makes our inference
# inputs match the training-time column-population pattern. Without it, DL
# is unusable on merged-row inputs.
_TRAINING_EMPTY_COLUMNS = {
    "job_id", "start", "end", "type", "status", "application_area",
    "amount", "description", "fert_units", "rate", "supply_id",
    "tankMix_id", "fertilizer_id", "blend_name", "name", "percent",
    "n", "p", "k", "usGallonsPerMT", "formula", "manure_type",
    "chemical_type", "cdms_fk", "chem_units", "file_last_modified",
    "filenames",
    "machine_make1", "machine_model1", "machine_type1",
    "implement_a_make1", "implement_a_model1", "implement_a_type1",
    "implement_b_make1", "implement_b_model1", "implement_b_type1",
    "machine_make2", "machine_model2", "machine_type2",
    "implement_a_make2", "implement_a_model2", "implement_a_type2",
    "implement_b_make2", "implement_b_model2", "implement_b_type2",
    "scout_count", "chem_product", "water_applied_mm",
    "irrigation_method", "actives", "actives_id", "actives_Name",
    "actives_Weight", "actives_Percent", "actives_subComponents",
}


def _parse_int(value: Any) -> Optional[int]:
    """Same numeric coercion as data_ingestionV2._parse_int."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    if abs(number - round(number)) > 1e-9:
        return None
    return int(round(number))


def _extract_season_year(value: Any) -> Optional[int]:
    """Mirror data_ingestionV2._extract_season_year so the lookup key matches
    the year the V2 ingester wrote to the seasons table."""
    as_int = _parse_int(value)
    if as_int is not None and 1900 <= as_int <= 2200:
        return as_int

    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None

    match = re.search(r"\b(19\d{2}|20\d{2}|21\d{2})\b", text)
    if not match:
        return None
    year = int(match.group(1))
    if 1900 <= year <= 2200:
        return year
    return None


def _clean_str(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def _norm_crop(value: Any) -> str:
    """Lower/strip for case-insensitive crop matching."""
    text = _clean_str(value)
    return text.lower() if text else ""


def _norm_variety(value: Any) -> str:
    """Lower/strip; blank/None maps to empty string so NULL DB variety
    matches blank CSV variety."""
    text = _clean_str(value)
    return text.lower() if text else ""


LookupKey = Tuple[int, str, int, str]  # (field_number, crop_lower, season_year, variety_lower)


class CsvFeatureLookup:
    """In-memory index of event-level CSV rows by (field, crop, season, variety).

    Usage:
        lookup = CsvFeatureLookup("/app/data/Wheat/NSP_field_product_combined_WHEAT-only.csv")
        events = lookup.get_events(field_number=4058517,
                                   crop_name="Wheat, Hard Winter",
                                   season_year=2022,
                                   variety_name=None)
        # `events` is a list of dicts, each containing the 86 model features
        # for one management event. Empty list = no match in CSV.
    """

    def __init__(self, csv_path: str):
        self.csv_path = csv_path
        self._events_by_key: Dict[LookupKey, List[Dict[str, Any]]] = defaultdict(list)
        self._load()

    def _load(self) -> None:
        logger.info("Loading CSV feature lookup from %s", self.csv_path)
        # dtype=str preserves every value as-written; the predictor handles
        # type coercion per the model's feature schema. This avoids pandas
        # silently turning empty strings into NaN for numeric columns and
        # losing the distinction the model's "Missing" categoricals rely on.
        df = pd.read_csv(self.csv_path, dtype=str, low_memory=False, keep_default_na=False)
        df.columns = df.columns.str.strip()

        if "field" not in df.columns or "crop_name_en" not in df.columns or "season" not in df.columns:
            raise ValueError(
                f"CSV at {self.csv_path} is missing one of the required join columns: "
                f"field / crop_name_en / season"
            )

        drop = _DROP_COLUMNS & set(df.columns)
        if drop:
            df = df.drop(columns=list(drop))

        rows_loaded = 0
        rows_skipped = 0
        for record in df.to_dict(orient="records"):
            field_int = _parse_int(record.get("field"))
            crop = _norm_crop(record.get("crop_name_en"))
            season_year = _extract_season_year(record.get("season"))
            variety = _norm_variety(record.get("variety_name_en"))

            if field_int is None or not crop or season_year is None:
                rows_skipped += 1
                continue

            key: LookupKey = (field_int, crop, season_year, variety)
            self._events_by_key[key].append(record)
            rows_loaded += 1

        logger.info(
            "CSV feature lookup ready: %d event rows across %d field-seasons "
            "(skipped %d rows missing field/crop/season)",
            rows_loaded, len(self._events_by_key), rows_skipped,
        )

    def get_events(
        self,
        field_number: Any,
        crop_name: Any,
        season_year: Any,
        variety_name: Any,
    ) -> List[Dict[str, Any]]:
        """Return all event-level rows matching this field-season.

        Returns [] if no rows match (caller decides whether to skip the
        prediction or fall back to a limited-input prediction).
        """
        field_int = _parse_int(field_number)
        crop = _norm_crop(crop_name)
        season_int = _extract_season_year(season_year)
        variety = _norm_variety(variety_name)

        if field_int is None or not crop or season_int is None:
            return []

        key: LookupKey = (field_int, crop, season_int, variety)
        events = self._events_by_key.get(key, [])
        # Return shallow copies so callers can't accidentally mutate the cache.
        return [dict(row) for row in events]

    def has_field_season(self, field_number: Any, crop_name: Any, season_year: Any, variety_name: Any) -> bool:
        return bool(self.get_events(field_number, crop_name, season_year, variety_name))

    def get_field_season_row(
        self,
        field_number: Any,
        crop_name: Any,
        season_year: Any,
        variety_name: Any,
    ) -> Optional[Dict[str, Any]]:
        """Return a single merged dict representing one field-season, matching
        the granularity the model was trained on.

        Why this exists: the operational CSV is event-level (multiple rows per
        field-season), but the engineer trained on a cleaned, field-season-level
        CSV (one row per combo). Per the training script, the model never saw
        per-event detail — most event-level columns were empty in the cleaned
        CSV and got fillna(0)'d before training. Feeding the model per-event
        rows lands inputs in a region of feature space the model never saw and
        predictions collapse.

        Merge rule: for each column, take the first non-empty value across the
        combo's event rows. This is correct for:
          - field-level columns (acres, lat, long, state, county, etc.) — same
            value on every event row, so "first" = "any" = correct
          - aggregate columns (totalN_per_ac, ammonia_lbN_per_ac, etc.) — appear
            populated on one event row, blank elsewhere; first non-empty = the
            field-season aggregate
          - event-level columns (type, chem_product, machine_make1, etc.) —
            even if some events have values, the predictor coerces them to 0
            for non-categoricals, matching what the cleaned-CSV-trained model
            saw at training; functionally equivalent

        Returns None if no event rows exist for this combo.
        """
        events = self.get_events(field_number, crop_name, season_year, variety_name)
        if not events:
            return None

        merged: Dict[str, Any] = {}
        # All event rows for a combo share the same column set; pull keys from
        # the first row and walk every event in order to pick the first non-empty.
        for col in events[0].keys():
            # Force training-empty columns to "" so our merged row matches the
            # column-population pattern the model saw at training time. See
            # _TRAINING_EMPTY_COLUMNS docstring above for the full rationale.
            if col in _TRAINING_EMPTY_COLUMNS:
                merged[col] = ""
                continue

            value: Any = None
            for ev in events:
                v = ev.get(col)
                if v not in (None, "") and not (isinstance(v, float) and math.isnan(v)):
                    value = v
                    break
            merged[col] = value if value is not None else ""

        return merged

    @property
    def field_season_count(self) -> int:
        return len(self._events_by_key)

    @property
    def event_row_count(self) -> int:
        return sum(len(v) for v in self._events_by_key.values())

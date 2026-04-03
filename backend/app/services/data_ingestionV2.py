"""
Data ingestion service V2 - lean field-season ingestion for table use cases.

This service ingests only the columns needed by the field table and maps them to:
- fields
- crops
- varieties
- seasons
- field_seasons
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.database import models
from app.database.crud import (
    create_ingestion_log,
    get_ingestion_by_hash,
    update_ingestion_log,
)

logger = logging.getLogger(__name__)


class DataIngestionServiceV2:
    """
    Ingest CSV data using a strict, minimal column mapping designed for the field table.
    """

    COLUMN_ALIASES = {
        "field": ["field", "fieldId", "field_id", "field_number"],
        "crop": ["crop_name_en", "crop_name", "crop"],
        "acres": ["acres"],
        "variety": ["variety_name_en", "variety"],
        "season": ["season"],
        "state": ["state", "location"],
        "county": ["county"],
        "observed_yield": ["yield_bu_ac", "yield_bc_ac", "yield"],
        "n": ["totalN_per_ac", "n"],
        "p": ["totalP_per_ac", "p"],
        "k": ["totalK_per_ac", "k"],
    }

    REQUIRED_KEYS = ("field", "crop", "season")
    MISSING_FLAG_KEYS = ("observedYield", "n", "p", "k")

    def __init__(self, db: Session):
        self.db = db

        # Lightweight caches to reduce repeat lookups across duplicate-heavy files.
        self._crop_cache: Dict[str, models.Crop] = {}
        self._season_cache: Dict[int, models.Season] = {}
        self._variety_cache: Dict[tuple[str, int], models.Variety] = {}
        self._field_cache: Dict[int, models.Field] = {}
        self._field_season_cache: Dict[tuple[int, int, Optional[int], int], Optional[models.FieldSeason]] = {}

    def compute_file_hash(self, filepath: str) -> str:
        sha256_hash = hashlib.sha256()
        with open(filepath, "rb") as file_obj:
            for byte_block in iter(lambda: file_obj.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    def _clean_str(self, value: Any) -> Optional[str]:
        if value is None or pd.isna(value):
            return None
        text = str(value).strip()
        if not text or text.lower() in {"nan", "none", "null"}:
            return None
        return text

    def _parse_float(self, value: Any) -> Optional[float]:
        text = self._clean_str(value)
        if text is None:
            return None
        try:
            number = float(text)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number):
            return None
        return number

    def _parse_int(self, value: Any) -> Optional[int]:
        number = self._parse_float(value)
        if number is None:
            return None
        if abs(number - round(number)) > 1e-9:
            return None
        return int(round(number))

    def _extract_season_year(self, value: Any) -> Optional[int]:
        # Handles plain years ("2024") and labels like "2023 Crop 2".
        as_int = self._parse_int(value)
        if as_int is not None and 1900 <= as_int <= 2200:
            return as_int

        text = self._clean_str(value)
        if text is None:
            return None

        match = re.search(r"\b(19\d{2}|20\d{2}|21\d{2})\b", text)
        if not match:
            return None
        year = int(match.group(1))
        if 1900 <= year <= 2200:
            return year
        return None

    def _resolve_columns(self, csv_path: str) -> Dict[str, Optional[str]]:
        header = pd.read_csv(csv_path, nrows=0).columns.tolist()
        normalized = {col.strip(): col for col in header}

        resolved: Dict[str, Optional[str]] = {}
        for key, aliases in self.COLUMN_ALIASES.items():
            found = None
            for alias in aliases:
                if alias in normalized:
                    found = normalized[alias]
                    break
            resolved[key] = found

        return resolved

    def _value(self, row: pd.Series, resolved: Dict[str, Optional[str]], key: str) -> Any:
        column = resolved.get(key)
        if not column:
            return None
        return row.get(column)

    def _crop_cache_key(self, crop_name: str) -> str:
        return crop_name.strip().lower()

    def _variety_cache_key(self, variety_name: str, crop_id: int) -> tuple[str, int]:
        return (variety_name.strip().lower(), crop_id)

    def _get_or_create_crop(self, crop_name: str) -> models.Crop:
        key = self._crop_cache_key(crop_name)
        cached = self._crop_cache.get(key)
        if cached is not None:
            return cached

        crop = (
            self.db.query(models.Crop)
            .filter(models.Crop.crop_name_en.ilike(crop_name))
            .first()
        )
        if crop is None:
            crop = models.Crop(crop_name_en=crop_name, is_active=True)
            self.db.add(crop)
            self.db.flush()

        self._crop_cache[key] = crop
        return crop

    def _get_or_create_season(self, season_year: int) -> models.Season:
        cached = self._season_cache.get(season_year)
        if cached is not None:
            return cached

        season = (
            self.db.query(models.Season)
            .filter(models.Season.season_year == season_year)
            .first()
        )
        if season is None:
            season = models.Season(season_year=season_year, is_current=False)
            self.db.add(season)
            self.db.flush()

        self._season_cache[season_year] = season
        return season

    def _get_or_create_variety(self, variety_name: str, crop_id: int) -> models.Variety:
        cache_key = self._variety_cache_key(variety_name, crop_id)
        cached = self._variety_cache.get(cache_key)
        if cached is not None:
            return cached

        variety = (
            self.db.query(models.Variety)
            .filter(
                models.Variety.crop_id == crop_id,
                models.Variety.variety_name_en.ilike(variety_name),
            )
            .first()
        )
        if variety is None:
            variety = models.Variety(
                variety_name_en=variety_name,
                crop_id=crop_id,
                is_active=True,
            )
            self.db.add(variety)
            self.db.flush()

        self._variety_cache[cache_key] = variety
        return variety

    def _get_or_create_field(
        self,
        field_number: int,
        acres: Optional[float],
        state: Optional[str],
        county: Optional[str],
    ) -> models.Field:
        cached = self._field_cache.get(field_number)
        if cached is not None:
            field = cached
        else:
            field = (
                self.db.query(models.Field)
                .filter(models.Field.field_number == field_number)
                .first()
            )
            if field is None:
                field = models.Field(
                    field_number=field_number,
                    acres=acres,
                    state=state,
                    county=county,
                    grower_id=None,
                )
                self.db.add(field)
                self.db.flush()
            self._field_cache[field_number] = field

        updated = False
        if acres is not None and field.acres is None:
            field.acres = acres
            updated = True
        if state and not field.state:
            field.state = state
            updated = True
        if county and not field.county:
            field.county = county
            updated = True

        if updated:
            self.db.flush()

        return field

    def _field_season_key(
        self,
        field_id: int,
        crop_id: int,
        variety_id: Optional[int],
        season_id: int,
    ) -> tuple[int, int, Optional[int], int]:
        return (field_id, crop_id, variety_id, season_id)

    def _get_field_season(
        self,
        field_id: int,
        crop_id: int,
        variety_id: Optional[int],
        season_id: int,
    ) -> Optional[models.FieldSeason]:
        cache_key = self._field_season_key(field_id, crop_id, variety_id, season_id)
        if cache_key in self._field_season_cache:
            return self._field_season_cache[cache_key]

        query = self.db.query(models.FieldSeason).filter(
            models.FieldSeason.field_id == field_id,
            models.FieldSeason.crop_id == crop_id,
            models.FieldSeason.season_id == season_id,
        )
        if variety_id is None:
            query = query.filter(models.FieldSeason.variety_id.is_(None))
        else:
            query = query.filter(models.FieldSeason.variety_id == variety_id)

        existing = query.first()
        self._field_season_cache[cache_key] = existing
        return existing

    def _build_missing_flags(
        self,
        observed_yield: Optional[float],
        n_value: Optional[float],
        p_value: Optional[float],
        k_value: Optional[float],
    ) -> Dict[str, str]:
        flags: Dict[str, str] = {}
        if observed_yield is None:
            flags["observedYield"] = "No data"
        if n_value is None:
            flags["n"] = "No data"
        if p_value is None:
            flags["p"] = "No data"
        if k_value is None:
            flags["k"] = "No data"
        return flags

    def _merge_missing_flags(
        self,
        existing: Optional[Dict[str, Any]],
        new_flags: Dict[str, str],
    ) -> Optional[Dict[str, Any]]:
        merged: Dict[str, Any] = {}
        if isinstance(existing, dict):
            merged.update(existing)

        # Replace V2 metric missing-data status with the latest row's state.
        for key in self.MISSING_FLAG_KEYS:
            merged.pop(key, None)

        merged.update(new_flags)
        return merged or None

    def _process_row(
        self,
        row: pd.Series,
        resolved: Dict[str, Optional[str]],
        source_filename: str,
    ) -> str:
        field_number = self._parse_int(self._value(row, resolved, "field"))
        crop_name = self._clean_str(self._value(row, resolved, "crop"))
        season_year = self._extract_season_year(self._value(row, resolved, "season"))

        if not field_number or not crop_name or not season_year:
            return "skipped"

        acres = self._parse_float(self._value(row, resolved, "acres"))
        variety_name = self._clean_str(self._value(row, resolved, "variety"))
        state = self._clean_str(self._value(row, resolved, "state"))
        county = self._clean_str(self._value(row, resolved, "county"))

        observed_yield = self._parse_float(self._value(row, resolved, "observed_yield"))
        n_value = self._parse_float(self._value(row, resolved, "n"))
        p_value = self._parse_float(self._value(row, resolved, "p"))
        k_value = self._parse_float(self._value(row, resolved, "k"))

        crop = self._get_or_create_crop(crop_name)
        season = self._get_or_create_season(season_year)
        variety = self._get_or_create_variety(variety_name, crop.crop_id) if variety_name else None
        field = self._get_or_create_field(field_number, acres, state, county)

        variety_id = variety.variety_id if variety else None
        existing_fs = self._get_field_season(field.field_id, crop.crop_id, variety_id, season.season_id)

        missing_flags = self._build_missing_flags(observed_yield, n_value, p_value, k_value)

        if existing_fs is None:
            fs = models.FieldSeason(
                field_id=field.field_id,
                crop_id=crop.crop_id,
                variety_id=variety_id,
                season_id=season.season_id,
                yield_bu_ac=observed_yield,
                totalN_per_ac=n_value,
                totalP_per_ac=p_value,
                totalK_per_ac=k_value,
                record_source=source_filename,
                data_quality_score=1.0,
                missing_data_flags=missing_flags or None,
            )
            self.db.add(fs)
            self.db.flush()
            self._field_season_cache[self._field_season_key(field.field_id, crop.crop_id, variety_id, season.season_id)] = fs
            return "inserted"

        updated = False
        for attr, value in (
            ("yield_bu_ac", observed_yield),
            ("totalN_per_ac", n_value),
            ("totalP_per_ac", p_value),
            ("totalK_per_ac", k_value),
        ):
            if value is not None and getattr(existing_fs, attr) is None:
                setattr(existing_fs, attr, value)
                updated = True

        merged_flags = self._merge_missing_flags(existing_fs.missing_data_flags, missing_flags)
        if merged_flags != existing_fs.missing_data_flags:
            existing_fs.missing_data_flags = merged_flags
            updated = True

        if source_filename and not existing_fs.record_source:
            existing_fs.record_source = source_filename
            updated = True

        if updated:
            self.db.flush()
            return "updated"

        return "skipped"

    def ingest_csv(
        self,
        csv_path: str,
        source_filename: Optional[str] = None,
        chunk_size: int = 10000,
    ) -> Dict[str, Any]:
        source_filename = source_filename or os.path.basename(csv_path)
        file_hash = self.compute_file_hash(csv_path)

        existing_log = get_ingestion_by_hash(self.db, file_hash)
        if existing_log and existing_log.status == "completed":
            return {
                "status": "skipped",
                "message": "File already ingested",
                "ingestion_id": existing_log.ingestion_id,
            }

        if existing_log:
            update_ingestion_log(
                self.db,
                ingestion_id=existing_log.ingestion_id,
                source_filename=source_filename,
                status="processing",
                records_parsed=0,
                records_inserted=0,
                records_updated=0,
                records_skipped=0,
                error_details=None,
                ingestion_completed_at=None,
            )
            ingestion_id = existing_log.ingestion_id
        else:
            created_log = create_ingestion_log(
                self.db,
                {
                    "source_filename": source_filename,
                    "file_hash": file_hash,
                    "status": "processing",
                },
            )
            ingestion_id = created_log.ingestion_id

        records_parsed = 0
        records_inserted = 0
        records_updated = 0
        records_skipped = 0

        try:
            resolved = self._resolve_columns(csv_path)
            missing_required = [key for key in self.REQUIRED_KEYS if not resolved.get(key)]
            if missing_required:
                raise ValueError(f"CSV is missing required columns for V2 ingestion: {', '.join(missing_required)}")

            usecols = sorted({col for col in resolved.values() if col})

            for chunk in pd.read_csv(
                csv_path,
                usecols=usecols,
                chunksize=chunk_size,
                dtype=str,
                low_memory=False,
            ):
                chunk.columns = chunk.columns.str.strip()

                for _, row in chunk.iterrows():
                    records_parsed += 1
                    try:
                        with self.db.begin_nested():
                            result = self._process_row(row=row, resolved=resolved, source_filename=source_filename)
                        if result == "inserted":
                            records_inserted += 1
                        elif result == "updated":
                            records_updated += 1
                        else:
                            records_skipped += 1
                    except Exception as row_error:  # pragma: no cover - defensive logging path
                        logger.error("V2 ingestion failed on row %s: %s", records_parsed, row_error)
                        records_skipped += 1

                self.db.commit()

            update_ingestion_log(
                self.db,
                ingestion_id=ingestion_id,
                records_parsed=records_parsed,
                records_inserted=records_inserted,
                records_updated=records_updated,
                records_skipped=records_skipped,
                status="completed",
                ingestion_completed_at=datetime.now(timezone.utc),
            )

            return {
                "status": "completed",
                "ingestion_id": ingestion_id,
                "records_parsed": records_parsed,
                "records_inserted": records_inserted,
                "records_updated": records_updated,
                "records_skipped": records_skipped,
                "column_mapping": resolved,
            }
        except Exception as ingest_error:
            self.db.rollback()
            try:
                update_ingestion_log(
                    self.db,
                    ingestion_id=ingestion_id,
                    records_parsed=records_parsed,
                    records_inserted=records_inserted,
                    records_updated=records_updated,
                    records_skipped=records_skipped,
                    status="failed",
                    error_details={"error": str(ingest_error)},
                )
            except Exception:
                logger.exception("Failed to update ingestion log after V2 error")

            raise

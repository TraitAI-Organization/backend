#!/usr/bin/env python
"""
Backfill yield_target values and management_events for existing field-seasons.

The default ingestion service (DataIngestionServiceV2) loads only field-season
basics — it ignores both `yield_target` and the per-row management-event
columns. The combined wheat CSV
(`data/Wheat/NSP_field_product_combined_WHEAT-only.csv`) carries all of that
information; this script reads it row-by-row, finds the matching
field_season already in the DB, and:

  - UPDATES field_seasons.yield_target when the CSV has a value AND the DB
    currently has NULL (so we never clobber operator-entered targets).
  - INSERTS a ManagementEvent for every row whose `type` column is populated,
    skipping any near-duplicate that already exists for the same
    field_season + event_type + start_date + amount + description signature.

Usage:
    docker compose -f docker-compose.local.yml exec backend python -m scripts.backfill_targets_and_events --csv /app/data/Wheat/NSP_field_product_combined_WHEAT-only.csv
    # or:
    docker compose -f docker-compose.local.yml exec backend python -m scripts.backfill_targets_and_events --csv /app/data/Wheat/NSP_field_product_combined_WHEAT-only.csv --dry-run

Both passes are idempotent — running the script twice produces no further
writes.
"""
from __future__ import annotations

import argparse
import csv
import logging
import math
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.database import models

logger = logging.getLogger("backfill_targets_and_events")

# Match the v1 ingestion service's date parser for consistency.
DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S.%f%z",
    "%Y-%m-%d %H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)


def _clean(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def _to_float(value: Any) -> Optional[float]:
    text = _clean(value)
    if text is None:
        return None
    try:
        num = float(text)
        if math.isfinite(num):
            return num
    except ValueError:
        pass
    return None


# Column precision bounds for the DECIMAL columns we write into. Postgres
# rejects the whole batch insert if any single value overflows, so we
# clamp here instead of letting the commit fail. Bounds are taken
# directly from app/database/models.py — keep these in sync if the
# schema changes.
#
# DECIMAL(precision, scale) means at most `precision` total digits with
# `scale` of them after the decimal point, so the maximum absolute value
# is 10**(precision - scale).
DECIMAL_BOUNDS = {
    # ManagementEvent
    "application_area": (10, 2),   # max abs < 10^8
    "amount": (12, 4),             # max abs < 10^8
    "rate": (10, 4),               # max abs < 10^6
    "water_applied_mm": (6, 2),    # max abs < 10^4
    # FieldSeason
    "yield_target": (6, 2),        # max abs < 10^4
}

# Per-column counter so the summary tells us which columns had drops.
_overflow_counts: Dict[str, int] = {}


def _bounded_float(value: Any, column: str) -> Optional[float]:
    """Parse `value` as a float, then drop it (return None) if it would
    overflow `column`'s DECIMAL(precision, scale) bounds. Tracks drops
    in `_overflow_counts` so the run summary can flag the columns that
    needed clamping. A None return is indistinguishable from a missing
    value, which is the correct outcome for the DB."""
    num = _to_float(value)
    if num is None:
        return None
    precision, scale = DECIMAL_BOUNDS.get(column, (None, None))
    if precision is None:
        return num
    limit = 10 ** (precision - scale)
    if abs(num) >= limit:
        _overflow_counts[column] = _overflow_counts.get(column, 0) + 1
        return None
    return num


def _to_int(value: Any) -> Optional[int]:
    f = _to_float(value)
    if f is None:
        return None
    try:
        return int(f)
    except (TypeError, ValueError):
        return None


def _to_datetime(value: Any) -> Optional[datetime]:
    text = _clean(value)
    if text is None:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    # Last-ditch attempt: ISO format
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _resolve_field_season_id(
    db: Session,
    cache: Dict[Tuple[int, int, Optional[int], int], Optional[int]],
    *,
    field_number: int,
    crop_name: str,
    variety_name: Optional[str],
    season_year: int,
) -> Optional[int]:
    """Look up the field_season_id for a given (field_number, crop, variety,
    season_year). Returns None if any link in the chain is missing."""
    cache_key = (field_number, hash(crop_name.lower()), hash((variety_name or "").lower()), season_year)
    if cache_key in cache:
        return cache[cache_key]

    field = db.query(models.Field).filter(models.Field.field_number == field_number).first()
    if not field:
        cache[cache_key] = None
        return None

    crop = db.query(models.Crop).filter(models.Crop.crop_name_en == crop_name).first()
    if not crop:
        cache[cache_key] = None
        return None

    season = db.query(models.Season).filter(models.Season.season_year == season_year).first()
    if not season:
        cache[cache_key] = None
        return None

    variety_id: Optional[int] = None
    if variety_name:
        variety = (
            db.query(models.Variety)
            .filter(models.Variety.variety_name_en == variety_name, models.Variety.crop_id == crop.crop_id)
            .first()
        )
        if variety:
            variety_id = variety.variety_id

    q = db.query(models.FieldSeason).filter(
        models.FieldSeason.field_id == field.field_id,
        models.FieldSeason.crop_id == crop.crop_id,
        models.FieldSeason.season_id == season.season_id,
    )
    if variety_id is not None:
        q = q.filter(models.FieldSeason.variety_id == variety_id)
    else:
        q = q.filter(models.FieldSeason.variety_id.is_(None))

    fs = q.first()
    fs_id = fs.field_season_id if fs else None
    cache[cache_key] = fs_id
    return fs_id


def _event_signature(field_season_id: int, event_type: str, start_date: Optional[datetime], amount: Optional[float], description: Optional[str]) -> Tuple:
    """Stable signature used to detect duplicates so the script is
    idempotent. Two events with the same (fs, type, start, amount,
    description) are treated as the same row — re-running the script
    won't insert a second copy."""
    return (
        field_season_id,
        event_type,
        start_date.isoformat() if start_date else None,
        round(amount, 4) if amount is not None else None,
        (description or "")[:200],
    )


def _load_existing_event_signatures(db: Session) -> set:
    """Pre-load signatures for every existing ManagementEvent so we can
    detect duplicates without a per-row query."""
    sigs: set = set()
    for ev in db.query(models.ManagementEvent).yield_per(1000):
        sigs.add(
            _event_signature(
                ev.field_season_id,
                ev.event_type or "",
                ev.start_date,
                float(ev.amount) if ev.amount is not None else None,
                ev.description,
            )
        )
    return sigs


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill yield_target + management_events from a wheat CSV.")
    parser.add_argument("--csv", required=True, help="Path to the combined wheat CSV.")
    parser.add_argument("--dry-run", action="store_true", help="Read and report, but don't commit.")
    parser.add_argument("--commit-every", type=int, default=2000, help="Commit batches of N writes.")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N rows (0 = no limit). Useful for spot checks.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    db: Session = SessionLocal()
    fs_cache: Dict[Tuple[int, int, Optional[int], int], Optional[int]] = {}

    logger.info("Pre-loading existing event signatures for de-duplication…")
    existing_sigs = _load_existing_event_signatures(db)
    logger.info("  loaded %d existing event signatures", len(existing_sigs))

    stats = {
        "rows_read": 0,
        "rows_resolved": 0,
        "rows_missing_field_season": 0,
        "targets_updated": 0,
        "targets_skipped_existing": 0,
        "events_inserted": 0,
        "events_skipped_duplicate": 0,
        "events_skipped_no_type": 0,
    }
    pending_writes = 0

    try:
        # The CSV has very large `actives` JSON cells — bump the field size limit.
        csv.field_size_limit(sys.maxsize)
        with open(args.csv, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                stats["rows_read"] += 1
                if args.limit and stats["rows_read"] > args.limit:
                    break

                field_number = _to_int(row.get("field"))
                crop_name = _clean(row.get("crop_name_en"))
                season_year = _to_int(row.get("season"))
                variety_name = _clean(row.get("variety_name_en"))

                if not (field_number and crop_name and season_year):
                    stats["rows_missing_field_season"] += 1
                    continue

                fs_id = _resolve_field_season_id(
                    db,
                    fs_cache,
                    field_number=field_number,
                    crop_name=crop_name,
                    variety_name=variety_name,
                    season_year=season_year,
                )
                if fs_id is None:
                    stats["rows_missing_field_season"] += 1
                    continue

                stats["rows_resolved"] += 1

                # --- Target backfill ---------------------------------------------------
                target_value = _bounded_float(row.get("yield_target"), "yield_target")
                if target_value is not None and target_value > 0:
                    fs = db.get(models.FieldSeason, fs_id)
                    if fs is not None:
                        if fs.yield_target is None:
                            if not args.dry_run:
                                fs.yield_target = target_value
                            stats["targets_updated"] += 1
                            pending_writes += 1
                        else:
                            stats["targets_skipped_existing"] += 1

                # --- Event insert ------------------------------------------------------
                event_type = _clean(row.get("type"))
                if not event_type:
                    stats["events_skipped_no_type"] += 1
                else:
                    start_date = _to_datetime(row.get("start"))
                    end_date = _to_datetime(row.get("end"))
                    amount = _bounded_float(row.get("amount"), "amount")
                    description = _clean(row.get("description"))

                    sig = _event_signature(fs_id, event_type, start_date, amount, description)
                    if sig in existing_sigs:
                        stats["events_skipped_duplicate"] += 1
                    else:
                        if not args.dry_run:
                            ev = models.ManagementEvent(
                                field_season_id=fs_id,
                                job_id=_to_int(row.get("job_id")),
                                event_type=event_type,
                                status=_clean(row.get("status")),
                                start_date=start_date,
                                end_date=end_date,
                                application_area=_bounded_float(row.get("application_area"), "application_area"),
                                amount=amount,
                                description=description,
                                fert_units=_clean(row.get("fert_units")),
                                rate=_bounded_float(row.get("rate"), "rate"),
                                fertilizer_id=_to_int(row.get("fertilizer_id")),
                                blend_name=_clean(row.get("blend_name")),
                                chemical_type=_clean(row.get("chemical_type")),
                                chem_product=_clean(row.get("chem_product")),
                                chem_units=_clean(row.get("chem_units")),
                                water_applied_mm=_bounded_float(row.get("water_applied_mm"), "water_applied_mm"),
                                irrigation_method=_clean(row.get("irrigation_method")),
                                machine_make1=_clean(row.get("machine_make1")),
                                machine_model1=_clean(row.get("machine_model1")),
                                machine_type1=_clean(row.get("machine_type1")),
                            )
                            db.add(ev)
                        existing_sigs.add(sig)
                        stats["events_inserted"] += 1
                        pending_writes += 1

                # --- Periodic commit ---------------------------------------------------
                if pending_writes >= args.commit_every:
                    if not args.dry_run:
                        db.commit()
                    pending_writes = 0
                    logger.info(
                        "Processed %d rows | targets+%d events+%d (dups %d, no-type %d, missing %d)",
                        stats["rows_read"],
                        stats["targets_updated"],
                        stats["events_inserted"],
                        stats["events_skipped_duplicate"],
                        stats["events_skipped_no_type"],
                        stats["rows_missing_field_season"],
                    )

        if not args.dry_run and pending_writes:
            db.commit()

        logger.info("=== Backfill summary ===")
        for k, v in stats.items():
            logger.info("  %-30s %d", k, v)
        if _overflow_counts:
            logger.info("--- decimal overflows (value dropped to NULL on event/row) ---")
            for col, n in sorted(_overflow_counts.items(), key=lambda kv: -kv[1]):
                logger.info("  %-30s %d", col, n)
        logger.info("Mode: %s", "DRY RUN" if args.dry_run else "COMMITTED")
        return 0

    except Exception:
        db.rollback()
        logger.exception("Backfill failed; rolled back uncommitted work.")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

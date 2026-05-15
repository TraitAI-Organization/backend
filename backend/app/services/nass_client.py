"""
USDA NASS Quick Stats client for winter-wheat Crop Progress data.

NASS publishes a weekly Crop Progress survey for every major winter-wheat
state. For winter wheat, only three phenological progress series are
tracked nationally, plus a five-bucket condition series:

    WHEAT, WINTER - PROGRESS, MEASURED IN PCT EMERGED      (fall, prior year)
    WHEAT, WINTER - PROGRESS, MEASURED IN PCT HEADED       (spring/early summer)
    WHEAT, WINTER - PROGRESS, MEASURED IN PCT HARVESTED    (summer)
    WHEAT, WINTER - CONDITION, MEASURED IN PCT {VERY POOR|POOR|FAIR|GOOD|EXCELLENT}

We pull all rows for (state, year) in a single request and parse them
client-side. Results are cached in-process with a TTL (default 6h) so we
never repeat a request inside one survey week, and we stay well under the
50k-row request cap.

If `NASS_API_KEY` is not configured, every call returns `None` and callers
should fall back to calendar-based estimates.

API key signup: https://quickstats.nass.usda.gov/api/
Terms & series definitions:
https://www.nass.usda.gov/Publications/National_Crop_Progress/terms_definitions.php
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


NASS_API_URL = "https://quickstats.nass.usda.gov/api/api_GET/"

# Two-letter postal code lookup for the major winter-wheat states the UI
# can ask about. NASS publishes state-level data for the major producers
# and rolls everything else into the national row.
STATE_NAME_TO_ALPHA: Dict[str, str] = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT",
    "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
    "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME",
    "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI",
    "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
    "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
    "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY",
}


# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------

@dataclass
class _CacheEntry:
    fetched_at: float
    rows: List[Dict[str, Any]]


_cache: Dict[Tuple[str, int], _CacheEntry] = {}
_cache_lock = threading.Lock()


def _cache_get(key: Tuple[str, int]) -> Optional[List[Dict[str, Any]]]:
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        if time.time() - entry.fetched_at > settings.nass_cache_ttl_seconds:
            _cache.pop(key, None)
            return None
        return entry.rows


def _cache_set(key: Tuple[str, int], rows: List[Dict[str, Any]]) -> None:
    with _cache_lock:
        _cache[key] = _CacheEntry(fetched_at=time.time(), rows=rows)


def clear_cache() -> None:
    """Test hook — drop all cached responses."""
    with _cache_lock:
        _cache.clear()


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

@dataclass
class ProgressSnapshot:
    """The current phenological snapshot for a state, distilled from the
    most recent NASS weekly survey row for each of the three series.

    Each `*_pct` is the percent of acres past that stage as of `*_week_ending`.
    `None` means the series has no published row this season yet (or the
    state is not surveyed for that series).
    """
    state_alpha: str
    year: int
    emerged_pct: Optional[float] = None
    emerged_week_ending: Optional[date] = None
    headed_pct: Optional[float] = None
    headed_week_ending: Optional[date] = None
    harvested_pct: Optional[float] = None
    harvested_week_ending: Optional[date] = None
    condition: Dict[str, float] = field(default_factory=dict)
    condition_week_ending: Optional[date] = None

    @property
    def latest_week_ending(self) -> Optional[date]:
        candidates = [
            self.emerged_week_ending,
            self.headed_week_ending,
            self.harvested_week_ending,
            self.condition_week_ending,
        ]
        non_null = [c for c in candidates if c is not None]
        return max(non_null) if non_null else None


# ---------------------------------------------------------------------------
# Fetch + parse
# ---------------------------------------------------------------------------

def _is_configured() -> bool:
    return bool(settings.nass_api_key)


def _parse_value(raw: Any) -> Optional[float]:
    """NASS publishes the percent as a string, occasionally with suppression
    flags like '(D)' (disclosure-suppressed) or '(NA)' (not available). Any
    non-numeric value becomes None so callers can fall back cleanly.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    try:
        return float(str(raw).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _parse_date(raw: Any) -> Optional[date]:
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw), "%Y-%m-%d").date()
    except ValueError:
        return None


def _fetch_rows(state_alpha: Optional[str], year: int) -> Optional[List[Dict[str, Any]]]:
    """Fetch all winter-wheat PROGRESS + CONDITION rows for (state, year).

    Pass `state_alpha=None` for the national rollup. Returns None on
    auth/network failure so callers can fall back. Returns an empty list
    when the API is reachable but has no rows yet (e.g. early in the season
    or in winter dormancy).
    """
    if not _is_configured():
        return None

    cache_key = (state_alpha or "US", year)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params: Dict[str, Any] = {
        "key": settings.nass_api_key,
        "commodity_desc": "WHEAT",
        "class_desc": "WINTER",
        "statisticcat_desc": ("PROGRESS", "CONDITION"),
        "year": str(year),
        "freq_desc": "WEEKLY",
        "format": "JSON",
    }
    if state_alpha:
        params["state_alpha"] = state_alpha
        params["agg_level_desc"] = "STATE"
    else:
        params["agg_level_desc"] = "NATIONAL"

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(NASS_API_URL, params=params)
    except httpx.HTTPError as exc:
        logger.warning("NASS request failed for %s/%s: %s", state_alpha, year, exc)
        return None

    if resp.status_code == 400:
        # NASS returns 400 with `{"error": ["no data"]}` when the filter
        # matches zero rows — common pre-season. Treat as "no data yet".
        try:
            body = resp.json()
            if isinstance(body.get("error"), list) and any(
                "no data" in str(msg).lower() for msg in body["error"]
            ):
                _cache_set(cache_key, [])
                return []
        except ValueError:
            pass
        logger.warning("NASS 400 for %s/%s: %s", state_alpha, year, resp.text[:200])
        return None

    if resp.status_code != 200:
        logger.warning(
            "NASS %s for %s/%s: %s", resp.status_code, state_alpha, year, resp.text[:200]
        )
        return None

    try:
        payload = resp.json()
    except ValueError:
        logger.warning("NASS returned non-JSON for %s/%s", state_alpha, year)
        return None

    rows = payload.get("data", []) if isinstance(payload, dict) else []
    _cache_set(cache_key, rows)
    return rows


def _latest_by_unit(
    rows: List[Dict[str, Any]], statisticcat: str, unit: str
) -> Optional[Dict[str, Any]]:
    """Return the row with the most recent `week_ending` matching the given
    statisticcat_desc / unit_desc combination, or None if no row matches."""
    matches = [
        r for r in rows
        if r.get("statisticcat_desc") == statisticcat
        and r.get("unit_desc") == unit
        and _parse_value(r.get("Value")) is not None
    ]
    if not matches:
        return None
    return max(matches, key=lambda r: r.get("week_ending") or "")


def get_progress_snapshot(
    state_alpha: Optional[str], year: int
) -> Optional[ProgressSnapshot]:
    """Build a ProgressSnapshot for (state, year) from the live NASS feed.

    Pass `state_alpha=None` for the national aggregate. `None` return means
    we couldn't reach NASS (missing key, network error, or unexpected
    response). An empty/partial snapshot (all fields None) means NASS is
    reachable but hasn't published rows for this state/year yet — that's
    expected pre-season and during winter dormancy.
    """
    rows = _fetch_rows(state_alpha, year)
    if rows is None:
        return None

    snap = ProgressSnapshot(state_alpha=state_alpha or "US", year=year)

    for unit, pct_attr, date_attr in (
        ("PCT EMERGED", "emerged_pct", "emerged_week_ending"),
        ("PCT HEADED", "headed_pct", "headed_week_ending"),
        ("PCT HARVESTED", "harvested_pct", "harvested_week_ending"),
    ):
        row = _latest_by_unit(rows, "PROGRESS", unit)
        if row is None:
            continue
        setattr(snap, pct_attr, _parse_value(row.get("Value")))
        setattr(snap, date_attr, _parse_date(row.get("week_ending")))

    # Condition: keep the most-recent set of all five buckets that share a
    # week_ending date. NASS publishes all five every week the survey runs.
    cond_buckets = (
        "PCT VERY POOR", "PCT POOR", "PCT FAIR", "PCT GOOD", "PCT EXCELLENT",
    )
    cond_rows = [
        r for r in rows
        if r.get("statisticcat_desc") == "CONDITION"
        and r.get("unit_desc") in cond_buckets
        and _parse_value(r.get("Value")) is not None
    ]
    if cond_rows:
        latest_week = max(r.get("week_ending") or "" for r in cond_rows)
        for r in cond_rows:
            if r.get("week_ending") != latest_week:
                continue
            label = r["unit_desc"].removeprefix("PCT ").title()  # "Very Poor", "Good", etc.
            snap.condition[label] = _parse_value(r.get("Value"))
        snap.condition_week_ending = _parse_date(latest_week)

    return snap


def state_alpha_for(state_name: str) -> Optional[str]:
    """Convert a UI-supplied state name (e.g. 'Kansas') to a NASS two-letter
    code. Returns None for unknown or aggregate names like 'United States' —
    callers should fall back to a national query or calendar estimate."""
    if not state_name:
        return None
    return STATE_NAME_TO_ALPHA.get(state_name.strip())

"""
Season-status endpoint for the Crop Studio overview banner.

Returns the live winter-wheat phenological snapshot for a given state by
proxying the USDA NASS Quick Stats Crop Progress survey. NASS publishes
weekly during the growing season (roughly early April through late
November); during the winter dormancy gap or pre-survey, fields will come
back null and the frontend should fall back to its calendar helpers.

NASS exposes only three phenological series for winter wheat:
PCT EMERGED, PCT HEADED, PCT HARVESTED — plus a five-bucket condition
series. We surface them all and let the frontend derive its UI labels.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.services import nass_client

logger = logging.getLogger(__name__)

router = APIRouter()


# Cutoffs used to derive the macro-stage tag from the latest NASS percents.
# These match the practical reading of the survey: a crop is "in heading"
# when more than ~5% of acres are headed and harvest has not begun; it is
# "in harvest" the moment any acreage has been combined. We don't pretend
# to distinguish anthesis / grain-fill / maturity here — NASS doesn't
# track those for wheat, so any sub-stage is necessarily a calendar guess
# and belongs in the frontend's fallback helper, not in API truth.
_HEADING_TRIGGER_PCT = 1.0
_HARVEST_TRIGGER_PCT = 1.0


def _derive_stage(
    snap: nass_client.ProgressSnapshot,
) -> Optional[str]:
    if snap.harvested_pct is not None and snap.harvested_pct >= _HARVEST_TRIGGER_PCT:
        if snap.harvested_pct >= 95:
            return "post_harvest"
        return "harvested"
    if snap.headed_pct is not None and snap.headed_pct >= _HEADING_TRIGGER_PCT:
        return "headed"
    if snap.emerged_pct is not None and snap.emerged_pct >= _HEADING_TRIGGER_PCT:
        return "emerged"
    return None


def _serialize(snap: nass_client.ProgressSnapshot) -> Dict[str, Any]:
    cond = snap.condition or {}
    good = cond.get("Good")
    excellent = cond.get("Excellent")
    good_to_excellent = None
    if good is not None or excellent is not None:
        good_to_excellent = (good or 0) + (excellent or 0)

    return {
        "state_alpha": snap.state_alpha,
        "year": snap.year,
        "stage": _derive_stage(snap),
        "as_of": snap.latest_week_ending.isoformat() if snap.latest_week_ending else None,
        "progress": {
            "emerged_pct": snap.emerged_pct,
            "emerged_week_ending": (
                snap.emerged_week_ending.isoformat() if snap.emerged_week_ending else None
            ),
            "headed_pct": snap.headed_pct,
            "headed_week_ending": (
                snap.headed_week_ending.isoformat() if snap.headed_week_ending else None
            ),
            "harvested_pct": snap.harvested_pct,
            "harvested_week_ending": (
                snap.harvested_week_ending.isoformat() if snap.harvested_week_ending else None
            ),
        },
        "condition": (
            {
                "week_ending": snap.condition_week_ending.isoformat()
                if snap.condition_week_ending
                else None,
                "very_poor": cond.get("Very Poor"),
                "poor": cond.get("Poor"),
                "fair": cond.get("Fair"),
                "good": good,
                "excellent": excellent,
                "good_to_excellent": good_to_excellent,
            }
            if cond
            else None
        ),
    }


@router.get(
    "",
    summary="Live winter-wheat season status from USDA NASS",
)
async def get_season_status(
    state: str = Query(
        ...,
        description=(
            "State name as shown in the UI (e.g. 'Kansas'). Pass "
            "'United States' for the national aggregate."
        ),
    ),
    year: Optional[int] = Query(
        None,
        description="Calendar year for the harvest. Defaults to the current year.",
        ge=2000,
        le=2100,
    ),
):
    """
    Return the latest USDA NASS Crop Progress snapshot for winter wheat
    in the given state. The response is shaped to drive the Crop Studio
    overview banner — the frontend picks the stage label, derives
    days-to-harvest, and falls back to calendar helpers when fields are
    null (dormancy gap, pre-survey, or NASS unavailable).

    Behaviour:
    - Unknown state → 404 (the dropdown only offers states we recognize).
    - NASS key unconfigured → 200 with `data: null` so the frontend
      falls back to calendar values without surfacing an error.
    - Reachable NASS, no rows yet → 200 with all `progress.*_pct` fields
      null; the frontend should treat this the same as the no-key case.
    """
    if year is None:
        year = datetime.now(timezone.utc).year

    state_clean = (state or "").strip()
    is_national = state_clean.lower() in {"united states", "us", "national"}

    if is_national:
        state_alpha: Optional[str] = None
    else:
        state_alpha = nass_client.state_alpha_for(state_clean)
        if state_alpha is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unknown state: {state!r}",
            )

    snap = nass_client.get_progress_snapshot(state_alpha, year)

    if snap is None:
        # NASS unreachable or key not configured — frontend will fall
        # back to calendar helpers.
        return {
            "state": state_clean,
            "data": None,
            "fallback_reason": "nass_unavailable",
        }

    return {
        "state": state_clean,
        "data": _serialize(snap),
        "source": {
            "name": "USDA NASS Quick Stats",
            "url": "https://quickstats.nass.usda.gov/",
            "series": [
                "WHEAT, WINTER - PROGRESS, MEASURED IN PCT EMERGED",
                "WHEAT, WINTER - PROGRESS, MEASURED IN PCT HEADED",
                "WHEAT, WINTER - PROGRESS, MEASURED IN PCT HARVESTED",
                "WHEAT, WINTER - CONDITION, MEASURED IN PCT {bucket}",
            ],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        },
    }

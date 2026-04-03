"""
Regional statistics service helpers used by prediction endpoints.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.database import crud


class RegionalStatsService:
    """
    Service wrapper around regional statistics CRUD helpers.
    """

    def __init__(self, db: Session):
        self.db = db

    def get_county_avg(
        self,
        crop: str,
        season: int,
        state: str,
        county: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Return county-level observed yield stats for a crop/season/state.

        When `county` is provided, returns that county's stats if available.
        Otherwise returns the top county by average observed yield in the state.
        """
        rows = crud.get_regional_yield_stats(
            db=self.db,
            crop=crop,
            season=season,
            state=state,
            county=county,
        )
        if not rows:
            return None

        if county:
            county_lower = county.strip().lower()
            for row in rows:
                row_county = str(row.get("county") or "").strip().lower()
                if row_county == county_lower:
                    return row
            return None

        return rows[0]

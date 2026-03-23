"""
Regional statistics service
"""
from sqlalchemy.orm import Session
from typing import Dict, List, Any, Optional
import logging

from app.database import crud

logger = logging.getLogger(__name__)


class RegionalStatsService:
    """
    Service for computing regional yield statistics.

    Provides:
    - County-level averages for crop/season
    - State-level averages
    - Comparison metrics
    """

    def __init__(self, db: Session):
        self.db = db

    def get_county_avg(
        self,
        crop: str,
        season: int,
        state: str,
        county: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get average yield for a county (or all counties in a state).

        Returns:
            {
                "crop": "Sorghum",
                "season": 2025,
                "state": "Kansas",
                "county": "Ford",  # if county specified
                "avg_yield": 72.3,
                "std": 12.1,
                "sample_size": 145,
                "percentile_25": 62.0,
                "percentile_75": 82.5
            }
        """
        results = crud.get_regional_yield_stats(
            self.db,
            crop=crop,
            season=season,
            state=state,
            county=county
        )

        if not results:
            return None

        if county:
            return results[0]
        else:
            return results  # list of all counties

    def get_county_avg_with_historical(
        self,
        crop: str,
        state: str,
        county: str,
        n_years: int = 3
    ) -> Dict[str, Any]:
        """
        Get county average yield over multiple years.

        Useful for trend analysis and anomaly detection.
        """
        from sqlalchemy import func

        # Query historical averages
        query = self.db.query(
            models.Season.season_year,
            func.avg(models.FieldSeason.yield_bu_ac).label('avg_yield'),
            func.stddev(models.FieldSeason.yield_bu_ac).label('std_yield'),
            func.count(models.FieldSeason.field_season_id).label('sample_size'),
        ).join(
            models.FieldSeason, models.Season.season_id == models.FieldSeason.season_id
        ).join(
            models.Field, models.FieldSeason.field_id == models.Field.field_id
        ).join(
            models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
        ).filter(
            models.Crop.crop_name_en.ilike(crop),
            models.Field.state == state,
            models.Field.county == county,
            models.FieldSeason.yield_bu_ac.isnot(None),
        ).group_by(
            models.Season.season_year
        ).order_by(
            models.Season.season_year.desc()
        ).limit(n_years)

        results = query.all()

        historical = [
            {
                'season': r.season_year,
                'avg_yield': float(r.avg_yield) if r.avg_yield else None,
                'std': float(r.std_yield) if r.std_yield else None,
                'sample_size': r.sample_size,
            }
            for r in results
        ]

        return {
            'county': county,
            'state': state,
            'crop': crop,
            'historical': historical,
        }

    def compute_regional_ranking(
        self,
        crop: str,
        season: int,
        state: str,
        predicted_yield: float
    ) -> Dict[str, Any]:
        """
        Compare a predicted yield to regional distribution.

        Returns:
        {
            "percentile_rank": 72.5,  # percentage of fields with lower yield
            "top_percentile": True,
            "num_fields_above": 45,
            "num_fields_below": 120,
            "regional_avg": 68.3,
            "regional_std": 10.2
        }
        """
        # Get all yields in the region for the crop/season
        from sqlalchemy import func
        from app.database import models

        query = self.db.query(
            models.FieldSeason.yield_bu_ac
        ).join(
            models.Field, models.FieldSeason.field_id == models.Field.field_id
        ).join(
            models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
        ).join(
            models.Season, models.FieldSeason.season_id == models.Season.season_id
        ).filter(
            models.Crop.crop_name_en.ilike(crop),
            models.Season.season_year == season,
            models.Field.state == state,
            models.FieldSeason.yield_bu_ac.isnot(None),
        )

        yields = [r[0] for r in query.all()]

        if not yields:
            return None

        yields_array = np.array(yields)
        mean = np.mean(yields_array)
        std = np.std(yields_array)

        # Percentile rank
        percentile = (yields_array < predicted_yield).mean() * 100

        # Number above/below
        num_above = (yields_array > predicted_yield).sum()
        num_below = (yields_array < predicted_yield).sum()

        return {
            'percentile': round(percentile, 1),
            'is_top': percentile >= 75,  # Top 25%
            'num_fields_above': int(num_above),
            'num_fields_below': int(num_below),
            'regional_avg': round(float(mean), 2),
            'regional_std': round(float(std), 2),
        }

    def get_variety_performance(
        self,
        crop: str,
        season: Optional[int] = None,
        state: Optional[str] = None,
        county: Optional[str] = None,
        min_samples: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Get variety-level statistics, optionally filtered by region.

        Returns list of varieties with:
        - mean observed yield
        - standard deviation
        - sample size
        - coefficient of variation
        """
        from sqlalchemy import func
        from app.database import models

        query = self.db.query(
            models.Variety.variety_name_en,
            func.avg(models.FieldSeason.yield_bu_ac).label('mean_yield'),
            func.stddev(models.FieldSeason.yield_bu_ac).label('std_yield'),
            func.count(models.FieldSeason.field_season_id).label('n'),
        ).join(
            models.FieldSeason, models.FieldSeason.variety_id == models.Variety.variety_id
        ).join(
            models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id
        ).join(
            models.Field, models.FieldSeason.field_id == models.Field.field_id
        ).join(
            models.Season, models.FieldSeason.season_id == models.Season.season_id
        ).filter(
            models.Crop.crop_name_en.ilike(crop),
            models.FieldSeason.yield_bu_ac.isnot(None),
        )

        if season:
            query = query.filter(models.Season.season_year == season)
        if state:
            query = query.filter(models.Field.state == state)
        if county:
            query = query.filter(models.Field.county == county)

        query = query.group_by(models.Variety.variety_name_en
        ).having(func.count(models.FieldSeason.field_season_id) >= min_samples
        ).order_by(func.avg(models.FieldSeason.yield_bu_ac).desc())

        results = query.all()

        varieties = []
        for r in results:
            mean_yield = float(r.mean_yield) if r.mean_yield else 0
            std_yield = float(r.std_yield) if r.std_yield else 0
            cv = (std_yield / mean_yield * 100) if mean_yield > 0 else 0

            varieties.append({
                'variety': r.variety_name_en,
                'mean_yield': round(mean_yield, 2),
                'std': round(std_yield, 2),
                'n': r.n,
                'cv': round(cv, 1),  # Coefficient of variation (%)
            })

        return varieties
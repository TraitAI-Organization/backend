"""
Fields endpoint - filtering, listing, details
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
import math

from app.database.session import get_db
from app.database import crud
from app.database.schemas import (
    FieldSeasonResponse,
    FieldSeasonDetailResponse,
    OverviewResponse,
    PaginatedResponse,
    PaginationParams,
)

router = APIRouter()


def _safe_float(value):
    if value is None:
        return None
    try:
        num = float(value)
        if not math.isfinite(num):
            return None
        return num
    except (TypeError, ValueError):
        return None


@router.get("/overview", response_model=OverviewResponse, summary="Dashboard overview")
async def get_overview(
    db: Session = Depends(get_db),
):
    """
    Get overall statistics for the dashboard.
    Returns counts, available filters, and yield ranges.
    """
    stats = crud.get_overview_stats(db)

    # Get latest model version info
    from app.ml.model_registry import ModelRegistry
    registry = ModelRegistry(db)
    model_versions = registry.get_latest_versions(limit=5)

    stats["model_versions"] = model_versions

    return stats


@router.get("", response_model=PaginatedResponse, summary="List field-season records")
async def list_field_seasons(
    db: Session = Depends(get_db),
    # Filters
    crop: Optional[str] = Query(None, description="Crop name (partial match)"),
    variety: Optional[str] = Query(None, description="Variety name (partial match)"),
    season: Optional[List[int]] = Query(None, description="Season year(s)"),
    state: Optional[str] = Query(None, description="State name"),
    county: Optional[str] = Query(None, description="County name"),
    acres: Optional[float] = Query(None, ge=0, description="Exact acres"),
    has_prediction: Optional[bool] = Query(None, description="Filter by prediction availability"),
    min_yield: Optional[float] = Query(None, description="Minimum predicted yield (requires has_prediction=true)"),
    max_yield: Optional[float] = Query(None, description="Maximum predicted yield (requires has_prediction=true)"),
    # When set, the predicted_yield/confidence/regional_avg fields on each row reflect
    # the latest prediction from this specific model_version_id. When omitted, the
    # latest prediction across any model is used (backward-compatible behavior).
    model_id: Optional[int] = Query(None, description="Filter latest prediction to this model_version_id"),
    # Pagination
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
):
    """
    Get paginated list of field-season records with filtering.

    **Filters:**
    - `crop` (e.g., "Sorghum", "Wheat, Hard Winter", "Corn")
    - `variety` (e.g., "Pioneer 86P20", "Grainfield")
    - `season` (e.g., 2025, [2024, 2025])
    - `state` (e.g., "Kansas")
    - `county` (e.g., "Ford")
    - `acres` (exact field size)
    - `has_prediction` (true/false - only show fields with predictions)
    - `min_yield`, `max_yield` (predicted yield range)

    **Response includes:**
    - Field details (field number, acres, location)
    - Crop and variety
    - Season
    - Observed yield (if available)
    - Predicted yield (if available) - field_seasons with ids will have predictions pre-fetched

    Returns paginated results with total count.
    """
    min_acres = acres if acres is not None else None
    max_acres = acres if acres is not None else None

    skip = (page - 1) * limit

    # Get total count for pagination
    total = crud.count_field_seasons(
        db=db,
        crop=crop,
        variety=variety,
        season=season,
        state=state,
        county=county,
        min_acres=min_acres,
        max_acres=max_acres,
        has_prediction=has_prediction,
    )

    # Get data
    field_seasons = crud.get_field_seasons(
        db=db,
        skip=skip,
        limit=limit,
        crop=crop,
        variety=variety,
        season=season,
        state=state,
        county=county,
        min_acres=min_acres,
        max_acres=max_acres,
        has_prediction=has_prediction,
        min_yield=min_yield,
        max_yield=max_yield,
    )

    # Build response items with essential info
    data = []
    for fs in field_seasons:
        item = {
            "field_season_id": fs.field_season_id,
            "field_number": fs.field.field_number if fs.field else None,
            "acres": _safe_float(fs.field.acres) if fs.field else None,
            "crop": fs.crop.crop_name_en if fs.crop else None,
            "variety": fs.variety.variety_name_en if fs.variety else None,
            "season": fs.season.season_year if fs.season else None,
            "state": fs.field.state if fs.field else None,
            "county": fs.field.county if fs.field else None,
            "lat": _safe_float(fs.field.lat) if fs.field else None,
            "long": _safe_float(fs.field.long) if fs.field else None,
            "yield_bu_ac": _safe_float(fs.yield_bu_ac),
            "totalN_per_ac": _safe_float(fs.totalN_per_ac),
            "totalP_per_ac": _safe_float(fs.totalP_per_ac),
            "totalK_per_ac": _safe_float(fs.totalK_per_ac),
        }

        # Add prediction if available. When model_id is set, only consider
        # predictions from that model so the toggle in the UI returns
        # per-model predicted yields. When omitted, fall back to the latest
        # prediction across any model (existing behavior).
        candidate_preds = fs.predictions or []
        if model_id is not None:
            candidate_preds = [p for p in candidate_preds if p.model_version_id == model_id]

        if candidate_preds:
            latest_pred = sorted(
                candidate_preds, key=lambda x: x.created_at, reverse=True
            )[0]
            pred_yield = _safe_float(latest_pred.predicted_yield)
            conf_low = _safe_float(latest_pred.confidence_lower)
            conf_high = _safe_float(latest_pred.confidence_upper)
            item["predicted_yield"] = pred_yield
            item["confidence_interval"] = [conf_low, conf_high] if conf_low is not None and conf_high is not None else None
            item["regional_avg_yield"] = _safe_float(latest_pred.regional_avg_yield)
            item["prediction_model_version_id"] = latest_pred.model_version_id
        else:
            item["predicted_yield"] = None
            item["confidence_interval"] = None
            item["regional_avg_yield"] = None
            item["prediction_model_version_id"] = None

        # Management event count
        item["management_event_count"] = len(fs.management_events) if fs.management_events else 0

        data.append(item)

    return {
        "data": data,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": math.ceil(total / limit) if total > 0 else 0,
    }


@router.get("/{field_season_id:int}", response_model=FieldSeasonDetailResponse, summary="Get field-season details")
async def get_field_season_detail(
    field_season_id: int,
    db: Session = Depends(get_db),
):
    """
    Get detailed information for a specific field-season record.

    Includes:
    - Field info (acres, location, grower)
    - Crop and variety
    - Season
    - Observed yield and target
    - Nutrient totals (N, P, K)
    - All management events (timeline of operations)
    - Prediction history (if available)
    - Data quality flags
    """
    fs = crud.get_field_season_with_details(db, field_season_id)
    if not fs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field-season with id {field_season_id} not found"
        )

    # Helper that converts a Decimal/None to a float without choking on null.
    def _f(value):
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _iso(value):
        if value is None:
            return None
        try:
            return value.isoformat()
        except AttributeError:
            return None

    # Optional columns on field_seasons — present in some deployments, not
    # others. We probe information_schema for which ones exist, then read
    # them via raw SQL so the endpoint works on either schema without
    # SQLAlchemy 500ing when the columns are missing. Column names are
    # validated against this whitelist before string interpolation, so
    # there is no SQL injection surface.
    OPTIONAL_FIELD_SEASON_COLUMNS = [
        "water_applied_mm",
        "ammonia_lbN_per_ac",
        "urea_lbN_per_ac",
        "ammonium_nitrate_lbN_per_ac",
        "ammonium_sulfate_lbN_per_ac",
        "urea_ammonium_nitrate_solution_lbN_per_ac",
        "monoammonium_phosphate_lbN_per_ac",
        "diammonium_phosphate_lbN_per_ac",
    ]
    optional_values = {c: None for c in OPTIONAL_FIELD_SEASON_COLUMNS}
    try:
        present_cols = {
            row[0]
            for row in db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'field_seasons' AND column_name = ANY(:cols)"
                ),
                {"cols": OPTIONAL_FIELD_SEASON_COLUMNS},
            ).fetchall()
        }
        if present_cols:
            # Double-quote each column to preserve case-sensitive Postgres
            # identifiers like "ammonia_lbN_per_ac" (which would lower-case
            # otherwise and fail to resolve).
            select_list = ", ".join(f'"{c}"' for c in sorted(present_cols))
            row = db.execute(
                text(f"SELECT {select_list} FROM field_seasons WHERE field_season_id = :id"),
                {"id": field_season_id},
            ).mappings().first()
            if row:
                for c in present_cols:
                    optional_values[c] = _f(row.get(c))
    except Exception:
        # Probe failure should not break the endpoint — the response just
        # carries nulls for all optional fields and the drawer hides the
        # N-source panel.
        pass

    # Build response (every numeric/datetime field passes through _f / _iso so
    # NULL values in the DB don't blow up the response builder).
    response = {
        "field_season_id": fs.field_season_id,
        "field_id": fs.field_id,
        "crop_id": fs.crop_id,
        "variety_id": fs.variety_id,
        "season_id": fs.season_id,
        "yield_bu_ac": _f(fs.yield_bu_ac),
        "yield_target": _f(fs.yield_target),
        "totalN_per_ac": _f(fs.totalN_per_ac),
        "totalP_per_ac": _f(fs.totalP_per_ac),
        "totalK_per_ac": _f(fs.totalK_per_ac),
        # Aggregated season-level irrigation total + N-source breakdown.
        # Values come from the information_schema probe above; columns
        # missing in this deployment are returned as null and the drawer
        # hides their UI panel.
        "water_applied_mm": optional_values["water_applied_mm"],
        "ammonia_lbN_per_ac": optional_values["ammonia_lbN_per_ac"],
        "urea_lbN_per_ac": optional_values["urea_lbN_per_ac"],
        "ammonium_nitrate_lbN_per_ac": optional_values["ammonium_nitrate_lbN_per_ac"],
        "ammonium_sulfate_lbN_per_ac": optional_values["ammonium_sulfate_lbN_per_ac"],
        "urea_ammonium_nitrate_solution_lbN_per_ac": optional_values["urea_ammonium_nitrate_solution_lbN_per_ac"],
        "monoammonium_phosphate_lbN_per_ac": optional_values["monoammonium_phosphate_lbN_per_ac"],
        "diammonium_phosphate_lbN_per_ac": optional_values["diammonium_phosphate_lbN_per_ac"],
        "record_source": fs.record_source,
        "data_quality_score": _f(fs.data_quality_score),
        "missing_data_flags": fs.missing_data_flags,
        # Some FieldSeason rows don't carry a created_at column at all
        # (legacy schema). getattr keeps this resilient instead of throwing
        # AttributeError mid-response.
        "created_at": getattr(fs, "created_at", None),
        # Joined data
        "field": {
            "field_id": fs.field.field_id,
            "field_number": fs.field.field_number,
            "acres": _f(fs.field.acres),
            "lat": _f(fs.field.lat),
            "long": _f(fs.field.long),
            "county": fs.field.county,
            "state": fs.field.state,
            "grower_id": fs.field.grower_id,
            # created_at is required by FieldResponse — pull it through
            # defensively in case any legacy row lacks the timestamp.
            "created_at": getattr(fs.field, "created_at", None),
        } if fs.field else None,
        "crop": {
            "crop_id": fs.crop.crop_id,
            "crop_name_en": fs.crop.crop_name_en,
        } if fs.crop else None,
        "variety": {
            "variety_id": fs.variety.variety_id,
            "variety_name_en": fs.variety.variety_name_en,
            # crop_id is required by VarietyBase — Variety rows always have a
            # crop FK, so this is just propagating it through to the response.
            "crop_id": fs.variety.crop_id,
        } if fs.variety else None,
        "season": {
            "season_id": fs.season.season_id,
            "season_year": fs.season.season_year,
        } if fs.season else None,
        "management_events": [
            {
                "event_id": ev.event_id,
                "job_id": ev.job_id,
                "event_type": ev.event_type,
                "status": ev.status,
                "start_date": _iso(ev.start_date),
                "end_date": _iso(ev.end_date),
                "application_area": _f(ev.application_area),
                "amount": _f(ev.amount),
                "description": ev.description,
                "fert_units": ev.fert_units,
                "rate": _f(ev.rate),
                "fertilizer_id": ev.fertilizer_id,
                "blend_name": ev.blend_name,
                "chemical_type": ev.chemical_type,
                "chem_product": ev.chem_product,
                "water_applied_mm": _f(ev.water_applied_mm),
                "irrigation_method": ev.irrigation_method,
                "machine_make1": ev.machine_make1,
                "machine_model1": ev.machine_model1,
            }
            # Some rows have neither start_date nor created_at — fall back to
            # event_id so the sort key never returns None and the comparison
            # doesn't blow up on mixed types.
            for ev in sorted(
                fs.management_events,
                key=lambda x: x.start_date or x.created_at or 0
            )
        ],
        "predictions": [
            {
                "prediction_id": pred.prediction_id,
                "predicted_yield": _f(pred.predicted_yield),
                "confidence_lower": _f(pred.confidence_lower),
                "confidence_upper": _f(pred.confidence_upper),
                "regional_avg_yield": _f(pred.regional_avg_yield),
                "feature_contributions": pred.feature_contributions,
                "created_at": _iso(pred.created_at),
                "model_version": {
                    "model_version_id": pred.model_version.model_version_id,
                    "version_tag": pred.model_version.version_tag,
                    "model_type": pred.model_version.model_type,
                } if pred.model_version else None,
            }
            for pred in sorted(fs.predictions, key=lambda x: x.created_at, reverse=True)
        ],
    }

    return response


@router.get("/crops/", summary="List all crops")
async def list_crops(
    db: Session = Depends(get_db),
    active_only: bool = Query(True, description="Only return active crops"),
    # When True (the default), only crops that have at least one field_season
    # record are returned. This is what frontend dropdowns want — listing
    # crops the user can't actually filter to is a UX trap. Pass
    # has_data=false to get every registered crop (admin / setup screens).
    has_data: bool = Query(
        True,
        description="Only return crops with at least one field_season record (default true; pass false for the full registry)",
    ),
):
    """
    Get list of crops in the system.
    """
    from app.database import crud, models

    if has_data:
        # Distinct join through field_season so we only surface crops that
        # actually appear in the data — matches the dropdown UX expectation.
        query = (
            db.query(models.Crop)
            .join(models.FieldSeason, models.FieldSeason.crop_id == models.Crop.crop_id)
            .distinct()
        )
        if active_only:
            query = query.filter(models.Crop.is_active == True)
        crops = query.all()
    else:
        crops = crud.get_crops(db, active_only=active_only)

    return [
        {"crop_id": c.crop_id, "crop_name_en": c.crop_name_en, "is_active": c.is_active}
        for c in crops
    ]


@router.get("/varieties/", summary="List varieties")
async def list_varieties(
    db: Session = Depends(get_db),
    crop: Optional[str] = Query(None, description="Filter by crop name"),
    active_only: bool = Query(True, description="Only return active varieties"),
    # When True (the default), only varieties that have at least one
    # field_season record are returned. Without this filter the dropdown
    # ends up showing varieties registered in the catalog but never
    # planted, which makes the table look like its filter is broken when
    # the user picks one. Pass has_data=false for the full registry.
    has_data: bool = Query(
        True,
        description="Only return varieties with at least one field_season record (default true; pass false for the full registry)",
    ),
):
    """
    Get list of varieties, optionally filtered by crop.
    """
    from app.database import crud, models

    query = db.query(models.Variety)
    if has_data:
        # Distinct join through field_season so we only surface varieties
        # the user can actually find data for. Without DISTINCT we'd get
        # one row per field_season — fine semantically, but wasteful.
        query = query.join(
            models.FieldSeason, models.FieldSeason.variety_id == models.Variety.variety_id
        ).distinct()
    if active_only:
        query = query.filter(models.Variety.is_active == True)
    if crop:
        crop_obj = crud.get_crop_by_name(db, crop)
        if not crop_obj:
            raise HTTPException(status_code=404, detail=f"Crop '{crop}' not found")
        query = query.filter(models.Variety.crop_id == crop_obj.crop_id)

    varieties = query.all()
    return [
        {
            "variety_id": v.variety_id,
            "variety_name_en": v.variety_name_en,
            "crop_id": v.crop_id,
            "is_active": v.is_active,
        }
        for v in varieties
    ]


@router.get("/seasons/", summary="List seasons")
async def list_seasons(
    db: Session = Depends(get_db),
):
    """
    Get list of all seasons in the system.
    """
    from app.database import crud
    seasons = crud.get_seasons(db)
    return [
        {"season_id": s.season_id, "season_year": s.season_year, "is_current": s.is_current}
        for s in seasons
    ]


@router.get("/states/", summary="List states")
async def list_states(
    db: Session = Depends(get_db),
):
    """
    Get distinct states from field records.
    """
    from app.database import models

    states = (
        db.query(models.Field.state)
        .filter(models.Field.state.isnot(None))
        .filter(models.Field.state != "")
        .distinct()
        .order_by(models.Field.state)
        .all()
    )
    return [{"state": state[0]} for state in states if state and state[0]]


@router.get("/yield-extremes/", summary="Records behind the min and max observed yield")
async def yield_extremes(
    db: Session = Depends(get_db),
):
    """
    Return the actual field-season rows that produced the min and max
    `yield_bu_ac` numbers shown on the dashboard's "Observed Yield Range"
    cards. The dashboard previously surfaced just the numeric extremes;
    this endpoint adds context (field number, crop, variety, season,
    state, county, acres) so the user can trace the value back to a real
    record in the DB rather than wondering which field hit it.
    """
    from app.database import models

    base = (
        db.query(models.FieldSeason)
        .join(models.Field, models.Field.field_id == models.FieldSeason.field_id)
        .join(models.Crop, models.Crop.crop_id == models.FieldSeason.crop_id)
        .outerjoin(models.Variety, models.Variety.variety_id == models.FieldSeason.variety_id)
        .filter(models.FieldSeason.yield_bu_ac.isnot(None))
        .filter(models.FieldSeason.yield_bu_ac > 0)
    )

    min_row = base.order_by(models.FieldSeason.yield_bu_ac.asc()).first()
    max_row = base.order_by(models.FieldSeason.yield_bu_ac.desc()).first()

    def _serialize(fs):
        if fs is None:
            return None
        return {
            "field_season_id": fs.field_season_id,
            "field_number": fs.field.field_number if fs.field else None,
            "yield_bu_ac": _safe_float(fs.yield_bu_ac),
            "acres": _safe_float(fs.field.acres) if fs.field else None,
            "crop": fs.crop.crop_name_en if fs.crop else None,
            "variety": fs.variety.variety_name_en if fs.variety else None,
            "season": fs.season.season_year if fs.season else None,
            "state": fs.field.state if fs.field else None,
            "county": fs.field.county if fs.field else None,
        }

    return {"min": _serialize(min_row), "max": _serialize(max_row)}


@router.get("/states/stats/", summary="Per-state aggregates (count, acres, avg yield, varieties)")
async def state_stats(
    db: Session = Depends(get_db),
):
    """
    Per-state aggregates across the full field data — used by the
    dashboard map's hover popup so it can show counts, regional avg
    yield, and the kinds of wheat grown for every state regardless of
    pagination. Returns one row per state with:

    - `count`: distinct field-season records for the state
    - `total_acres`: sum of distinct field acres for the state
    - `avg_yield`: mean of populated yield_bu_ac values for the state
    - `crops`: sorted distinct crop names planted in that state
    - `varieties`: sorted distinct variety names planted in that state
    """
    from app.database import models

    rows = (
        db.query(
            models.Field.state.label("state"),
            models.Field.field_id.label("field_id"),
            models.Field.acres.label("acres"),
            models.FieldSeason.field_season_id.label("field_season_id"),
            models.FieldSeason.yield_bu_ac.label("yield_bu_ac"),
            models.Crop.crop_name_en.label("crop_name"),
            models.Variety.variety_name_en.label("variety_name"),
        )
        .join(models.FieldSeason, models.FieldSeason.field_id == models.Field.field_id)
        .join(models.Crop, models.Crop.crop_id == models.FieldSeason.crop_id)
        .outerjoin(models.Variety, models.Variety.variety_id == models.FieldSeason.variety_id)
        .filter(models.Field.state.isnot(None))
        .filter(models.Field.state != "")
        .all()
    )

    # Roll up in Python so we can dedupe field_id (for acres) and
    # field_season_id (for count) without resorting to multiple queries.
    by_state: dict[str, dict] = {}
    for r in rows:
        entry = by_state.setdefault(
            r.state,
            {
                "state": r.state,
                "field_ids": set(),
                "field_season_ids": set(),
                "yields": [],
                "crops": set(),
                "varieties": set(),
                "acres_by_field": {},
            },
        )
        entry["field_season_ids"].add(r.field_season_id)
        if r.field_id is not None and r.field_id not in entry["acres_by_field"]:
            entry["field_ids"].add(r.field_id)
            acres = _safe_float(r.acres)
            if acres is not None:
                entry["acres_by_field"][r.field_id] = acres
        y = _safe_float(r.yield_bu_ac)
        if y is not None and y > 0:
            entry["yields"].append(y)
        if r.crop_name:
            entry["crops"].add(r.crop_name)
        if r.variety_name:
            entry["varieties"].add(r.variety_name)

    result = []
    for state, e in by_state.items():
        total_acres = sum(e["acres_by_field"].values())
        avg_yield = sum(e["yields"]) / len(e["yields"]) if e["yields"] else None
        result.append(
            {
                "state": state,
                "count": len(e["field_season_ids"]),
                "total_acres": total_acres,
                "avg_yield": avg_yield,
                "crops": sorted(e["crops"]),
                "varieties": sorted(e["varieties"]),
            }
        )
    result.sort(key=lambda x: x["state"])
    return result


@router.get("/counties/", summary="List counties")
async def list_counties(
    db: Session = Depends(get_db),
    state: Optional[str] = Query(None, description="Optional state filter"),
):
    """
    Get distinct counties from field records, optionally filtered by state.
    """
    from app.database import models

    query = (
        db.query(models.Field.county)
        .filter(models.Field.county.isnot(None))
        .filter(models.Field.county != "")
    )
    if state:
        query = query.filter(models.Field.state == state)

    counties = query.distinct().order_by(models.Field.county).all()
    return [{"county": county[0]} for county in counties if county and county[0]]

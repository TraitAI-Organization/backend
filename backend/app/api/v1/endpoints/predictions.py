"""
Prediction endpoints - ML model inference
"""
import json
import math
import os
from functools import lru_cache
from typing import Dict, Any, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
import logging

from app.database.session import get_db
from app.database import crud, models as db_models
from app.database.schemas import (
    PredictionRequest,
    PredictionResponse,
    FeatureContribution,
    MultiModelPredictionResponse,
    MultiModelPredictionItem,
    PredictionRunResponse,
)
from app.ml.predictor import PredictionService
from app.ml.explainability import ExplainabilityEngine
from app.services.regional_stats import RegionalStatsService

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# County-centroid lookup for lat/long enrichment
# ---------------------------------------------------------------------------
# `long` (importance 11.10) and `lat` (6.22) are the 2nd- and 4th-most
# important features in the live GenMills CatBoost model — between them
# they're roughly 17 importance points the model can use when both are
# present. The prediction wizard intentionally doesn't ask users for
# coordinates (most growers don't know their field's lat/long), so the
# request payload arrives with state + county but no coords. This lookup
# fills them in from a (state, county) -> centroid table derived from the
# training data, restoring the model's geographic signal.
#
# The enrichment is reported back in the response (`coordinates_source`)
# so the frontend can tell the user we used their county's centroid
# rather than asking them to provide coordinates manually.

_CENTROIDS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "data",
    "state_county_centroids.json",
)


@lru_cache(maxsize=1)
def _load_centroids() -> Dict[str, Dict[str, Dict[str, float]]]:
    """Load the state -> county -> {lat, long, training_rows} table.

    Cached for the process lifetime — the file is static, regenerated only
    when we retrain or import a new model.
    """
    try:
        with open(_CENTROIDS_PATH, "r") as fh:
            return json.load(fh)
    except FileNotFoundError:
        logger.warning(
            "Centroid lookup file not found at %s; lat/long will not be auto-filled",
            _CENTROIDS_PATH,
        )
        return {}
    except Exception as exc:
        logger.warning("Failed to load centroid lookup: %s", exc)
        return {}


def _resolve_centroid(state: Optional[str], county: Optional[str]) -> Optional[Tuple[float, float]]:
    """Return (lat, long) for a (state, county) pair, or None if not covered.

    The centroid table is derived from the model's training data, so any
    (state, county) that the model was actually trained on will resolve.
    Unsupported regions return None and the predict path will pass NaN
    coords to the model (same behavior as before this enrichment landed).
    """
    if not state or not county:
        return None
    centroids = _load_centroids()
    state_block = centroids.get(state)
    if not state_block:
        return None
    point = state_block.get(county)
    if not point:
        return None
    lat = point.get("lat")
    lng = point.get("long")
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


# ---------------------------------------------------------------------------
# Coverage-envelope loading for the Analytics scope filter
# ---------------------------------------------------------------------------
# The Analytics tab's "In model coverage" toggle scopes predicted-vs-observed
# plots and metrics to field-seasons whose (state, county, variety) was in
# the model's training envelope. This is the same coverage.json the
# prediction wizard reads — we resolve it lazily from the model registry
# (so we don't have to know the on-disk path here) and cache by model
# version id since coverage.json is static per model.
#
# Returned shape:
#   {
#     "states":             set of allowed state names,
#     "counties_by_state":  dict[state] -> set of allowed county names,
#     "varieties_by_crop":  dict[crop]  -> set of allowed variety names,
#     "loaded":             bool — False if coverage.json is missing for
#                           this model (callers should treat as "no scoping
#                           possible — return all rows").
#   }


@lru_cache(maxsize=8)
def _coverage_envelope(model_version_id: int) -> Dict[str, Any]:
    """Load coverage.json for a model version, normalized for set-based lookups.

    Cached per model_version_id; the registry path resolution is the
    expensive part and shouldn't run on every Analytics request. Returns
    a `loaded=False` payload when the model has no coverage file — the
    caller treats that as a no-op so legacy models still render.
    """
    from app.ml.model_registry import ModelRegistry  # local import to avoid cycle
    from app.database.session import SessionLocal

    # Resolve the model folder via the registry. The registry needs a Session,
    # but coverage resolution is read-only so a short-lived session is fine.
    session = SessionLocal()
    try:
        registry = ModelRegistry(session)
        mv = session.get(db_models.ModelVersion, model_version_id)
        if mv is None:
            return {"loaded": False, "states": set(), "counties_by_state": {}, "varieties_by_crop": {}}
        version_dir = registry._resolve_version_dir(mv.version_tag)
    finally:
        session.close()

    coverage_path = os.path.join(version_dir, "coverage.json")
    if not os.path.exists(coverage_path):
        logger.info(
            "Model %s has no coverage.json — Analytics 'In model coverage' filter will be a no-op",
            model_version_id,
        )
        return {"loaded": False, "states": set(), "counties_by_state": {}, "varieties_by_crop": {}}

    with open(coverage_path, "r") as fh:
        raw = json.load(fh)

    states = set(raw.get("states") or [])
    counties_by_state = {
        st: set(cs) for st, cs in (raw.get("counties_by_state") or {}).items()
    }
    varieties_by_crop = {
        crop: set(vs) for crop, vs in (raw.get("varieties_by_crop") or {}).items()
    }
    # Exact training row identifiers, when the coverage file records them.
    # This is the authoritative "in trained envelope" check — a prediction
    # is in-envelope iff its Field.field_number is in this set. Coerced to
    # int because the DB column is BigInteger and JSON may have round-
    # tripped the values as strings or floats. Empty set means the
    # geographic check is the only signal we have.
    training_field_numbers: set = set()
    for f in (raw.get("training_field_numbers") or []):
        try:
            training_field_numbers.add(int(f))
        except (TypeError, ValueError):
            continue
    # Numeric envelopes — used by the "in_distribution" scope to flag
    # rows whose continuous inputs (acres, totalN, etc.) or observed
    # yield fall outside the training range. We carry them through as
    # raw dicts so the row check can use min/max or p5/p95 depending
    # on how strict we want each field to be.
    yield_range = raw.get("yield_range") or {}
    numeric_ranges = raw.get("numeric_ranges") or {}

    return {
        "loaded": True,
        "states": states,
        "counties_by_state": counties_by_state,
        "varieties_by_crop": varieties_by_crop,
        "training_field_numbers": training_field_numbers,
        "yield_range": yield_range,
        "numeric_ranges": numeric_ranges,
    }


def _row_in_distribution(
    envelope: Dict[str, Any],
    state: Optional[str],
    county: Optional[str],
    crop: Optional[str],
    variety: Optional[str],
    yield_observed: Optional[float] = None,
    acres: Optional[float] = None,
    total_n: Optional[float] = None,
) -> bool:
    """Check whether a row's inputs are in the training distribution.

    This is the "loose-but-meaningful" filter used by the Analytics
    "Similar to training" view. A row qualifies when:

      - state is in the training states (envelope.states)
      - county is in the training counties for that state
      - variety is in the training varieties for that crop OR is null
        (null is admitted because 73% of training rows had it null)
      - observed yield falls inside the training yield range — this
        is the IQR-clip the training file used (e.g. 15.83 – 85.08
        bu/ac for wheat), so it's a meaningful "did this row look
        like the kind the model saw" test
      - acres is in the [min, max] training range (continuous)
      - totalN is in the [min, max] training range OR null

    Unlike _row_in_envelope's tier-1 check (exact training-set membership),
    this admits production rows that were NOT in training but whose
    inputs look like training-set rows — exactly the population the
    model's reported R² should apply to in production.

    Returns True when coverage isn't loaded so legacy models default
    to no scoping rather than rejecting everything.
    """
    if not envelope.get("loaded"):
        return True

    # Geographic envelope (same as the old _row_in_envelope's tier-2 check).
    if state not in envelope["states"]:
        return False
    counties = envelope["counties_by_state"].get(state, set())
    if county not in counties:
        return False
    if variety:
        varieties = envelope["varieties_by_crop"].get(crop, set())
        if variety not in varieties:
            return False

    # Yield range — the IQR clip the training data went through is what
    # separates the 1,002 training rows from the wider production set.
    # Production rows with yields above ~85 or below ~16 bu/ac (for wheat)
    # are outside the training distribution and should be flagged.
    yr = envelope.get("yield_range") or {}
    if yield_observed is not None and yr:
        ymin = yr.get("min")
        ymax = yr.get("max")
        if ymin is not None and yield_observed < ymin:
            return False
        if ymax is not None and yield_observed > ymax:
            return False

    # Continuous-input envelopes. We use [min, max] (not p5–p95) because
    # the training data already saw this range — anything inside is by
    # definition something the model has been exposed to. p5–p95 would
    # be over-tight and exclude legitimately trained-on tails.
    nr = envelope.get("numeric_ranges") or {}

    acres_meta = nr.get("acres")
    if acres is not None and acres_meta:
        amin = acres_meta.get("min")
        amax = acres_meta.get("max")
        if amin is not None and acres < amin:
            return False
        if amax is not None and acres > amax:
            return False

    # totalN: null is fine (model handles NaN natively). Only flag
    # values that are present AND outside the training range.
    n_meta = nr.get("totalN")
    if total_n is not None and n_meta:
        nmin = n_meta.get("min")
        nmax = n_meta.get("max")
        if nmin is not None and total_n < nmin:
            return False
        if nmax is not None and total_n > nmax:
            return False

    return True


def _row_in_envelope(
    envelope: Dict[str, Any],
    state: Optional[str],
    county: Optional[str],
    crop: Optional[str],
    variety: Optional[str],
    field_number: Optional[int] = None,
) -> bool:
    """Check whether a field-season is in the model's coverage envelope.

    Two-tier check:
      1. If coverage.json records `training_field_numbers` (the exact
         BigInteger field IDs the model was trained on), use that as
         the authoritative test — a row is in-envelope iff its
         field_number is in that set. This is the precise filter we
         want for Analytics: it identifies exactly the rows the
         model's published R² applies to. We strongly prefer this
         when available.

      2. Otherwise fall back to the (state, county, variety) geographic
         envelope check. Useful for older models without explicit
         field-ID lists, but on highly-overlapping production data
         (e.g. wheat across 5 states where most counties are in
         training) the geographic check admits too many rows. The
         tiered approach lets new models opt into the tighter filter
         without breaking the old ones.

    Returns True (no filter) when coverage isn't loaded at all so
    legacy models without coverage.json don't have everything excluded.
    """
    if not envelope.get("loaded"):
        return True

    # Tier 1: exact training-set membership when we have the field IDs.
    training_fields = envelope.get("training_field_numbers") or set()
    if training_fields:
        if field_number is None:
            return False
        try:
            return int(field_number) in training_fields
        except (TypeError, ValueError):
            return False

    # Tier 2: geographic fallback for coverage files that don't carry
    # explicit training field IDs.
    if state not in envelope["states"]:
        return False
    counties = envelope["counties_by_state"].get(state, set())
    if county not in counties:
        return False
    if variety:
        varieties = envelope["varieties_by_crop"].get(crop, set())
        if variety not in varieties:
            return False
    return True


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _enrich_request_features(
    request: "PredictionRequest",
) -> Tuple[Dict[str, Any], str, Dict[str, Any]]:
    """Shared enrichment pipeline used by every predict endpoint.

    Takes a PredictionRequest, applies (1) county-centroid lat/long fill
    when the user didn't supply coordinates and (2) live CSV-based
    enrichment that pulls regional averages for the ~75 features the
    wizard doesn't ask for. Returns:

        (enriched_features, coordinates_source, live_enrichment_metadata)

    `coordinates_source` is one of "user_provided", "county_centroid",
    "unavailable". `live_enrichment_metadata` is the dict returned by
    LiveEnrichmentLookup.enrich() — fields `source`, `rows`,
    `filled_fields`. Both are safe to ignore if the caller doesn't
    expose them in its response model.

    Why this is shared:
    Previously only the main /predictions endpoint enriched the
    request. The /predictions/model/{tag}, /predictions/all-models, and
    /predictions/batch endpoints all ran the lean 10-field payload
    through the model, which collapses predictions toward the training
    mean (~75 features defaulted to 0/"Missing"). Routing every endpoint
    through this helper keeps live, multi-model, and batch results
    consistent with the enriched-backfill predictions in the DB.
    """
    request_features = request.model_dump(exclude_none=True)
    county = getattr(request, "county", None)
    state = getattr(request, "state", None)

    # Centroid fill — only when the user didn't supply lat/long.
    user_lat = request_features.get("lat")
    user_long = request_features.get("long")
    coordinates_source = "user_provided" if (user_lat is not None and user_long is not None) else None
    if coordinates_source is None:
        centroid = _resolve_centroid(state, county)
        if centroid is not None:
            centroid_lat, centroid_long = centroid
            if user_lat is None:
                request_features["lat"] = centroid_lat
            if user_long is None:
                request_features["long"] = centroid_long
            coordinates_source = "county_centroid"
        else:
            coordinates_source = "unavailable"

    # Live enrichment — non-fatal if the CSV is missing.
    live_enrichment_metadata: Dict[str, Any] = {"source": "disabled", "rows": 0, "filled_fields": {}}
    try:
        from app.services.live_enrichment import get_live_enrichment_lookup
        lookup = get_live_enrichment_lookup()
        request_features, live_enrichment_metadata = lookup.enrich(request_features)
    except Exception as enrich_err:
        logger.warning("Live enrichment unavailable: %s", enrich_err, exc_info=True)

    return request_features, coordinates_source, live_enrichment_metadata


def _serialize_prediction_run(run: db_models.PredictionRun) -> Dict[str, Any]:
    return {
        "prediction_run_id": run.prediction_run_id,
        "model_version_id": run.model_version_id,
        "model_version_tag": run.model_version_tag,
        "crop": run.crop,
        "variety": run.variety,
        "season": run.season,
        "state": run.state,
        "county": run.county,
        "acres": _to_float(run.acres),
        "lat": _to_float(run.lat),
        "long": _to_float(run.long),
        "totalN_per_ac": _to_float(run.totalN_per_ac),
        "totalP_per_ac": _to_float(run.totalP_per_ac),
        "totalK_per_ac": _to_float(run.totalK_per_ac),
        "water_applied_mm": _to_float(run.water_applied_mm),
        "event_count": run.event_count,
        "predicted_yield": _to_float(run.predicted_yield) or 0.0,
        "confidence_lower": _to_float(run.confidence_lower),
        "confidence_upper": _to_float(run.confidence_upper),
        "regional_comparison": run.regional_comparison,
        "feature_contributions": run.feature_contributions or [],
        "request_payload": run.request_payload or {},
        "response_payload": run.response_payload or {},
        "created_at": run.created_at,
    }


@router.post("", response_model=PredictionResponse, summary="Predict yield")
async def predict_yield(
    request: PredictionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Predict crop yield based on input features.

    **Input Features:**
    - crop: Crop type (e.g., "Sorghum", "Wheat, Hard Winter")
    - variety: Optional variety name
    - acres: Field size in acres
    - lat, long: Field coordinates (WGS84)
    - season: Optional year (e.g., 2025)
    - totalN_per_ac: Total nitrogen applied (lb/ac)
    - totalP_per_ac: Total phosphorus applied (lb/ac)
    - totalK_per_ac: Total potassium applied (lb/ac)

    **Optional Features:**
    - water_applied_mm: Irrigation water applied
    - event_count: Number of management events
    - county: County name (for regional comparison)
    - state: State name (for regional comparison)

    **Returns:**
    - predicted_yield: Predicted yield in bu/ac
    - confidence_interval: [lower, upper] bounds
    - model_version: Version of model used
    - regional_comparison: How prediction compares to regional average
    - explainability: Top 5 contributing features with SHAP values
    """
    try:
        # Initialize prediction service
        predictor = PredictionService(db)

        # Get production model
        model_version = predictor.get_production_model()
        if not model_version:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No production model available. Please train a model first."
            )

        # Check if we have regional data for comparison
        county = request.county if hasattr(request, 'county') and request.county else None
        state = request.state if hasattr(request, 'state') and request.state else None

        # If county/state not provided, try to infer from lat/long
        if not county or not state or request.season is None:
            # Could use reverse geocoding here (future enhancement)
            regional_comparison = None
        else:
            regional_stats = RegionalStatsService(db)
            regional_avg = regional_stats.get_county_avg(
                crop=request.crop,
                season=request.season,
                state=state,
                county=county
            )
            regional_comparison = regional_avg

        # Centroid + CSV-driven feature enrichment. Shared with the
        # specific-model, all-models, and batch endpoints so every
        # prediction path feeds the model the same enriched payload —
        # otherwise the lean inputs collapse predictions toward the
        # training mean and live results disagree with the backfilled
        # rows already in the predictions table.
        request_features, coordinates_source, live_enrichment_metadata = _enrich_request_features(request)

        # Generate prediction
        prediction_result = predictor.predict(request_features, model_version)

        # Get explainability (best-effort; do not fail prediction if explanation fails)
        explanations = {"top_features": []}
        try:
            explainer = ExplainabilityEngine(db, predictor)
            explanations = explainer.explain_prediction(
                features=prediction_result['features'],
                model_version=model_version,
                base_value=prediction_result.get('base_value', 0.0)
            )
        except Exception as explain_err:
            logger.warning(
                f"Explainability unavailable for model {model_version.version_tag}: {explain_err}",
                exc_info=True,
            )

        # Build response
        response = PredictionResponse(
            predicted_yield=prediction_result['predicted_yield'],
            confidence_interval=[
                prediction_result['confidence_lower'],
                prediction_result['confidence_upper']
            ],
            confidence_level=prediction_result.get('confidence_level'),
            model_version=model_version.version_tag,
            regional_comparison=regional_comparison,
            explainability={
                "top_features": [
                    FeatureContribution(
                        feature=feat['feature'],
                        value=feat['value'],
                        direction=feat['direction'],
                        importance=feat['importance']
                    ).model_dump()
                    for feat in explanations['top_features'][:5]
                ]
            },
            recommendations=None,  # Future: fertilizer recommendations
            coordinates_source=coordinates_source,
            enrichment_source=live_enrichment_metadata.get("source"),
            enrichment_rows=live_enrichment_metadata.get("rows"),
            enrichment_filled_fields=live_enrichment_metadata.get("filled_fields") or None,
        )

        request_payload = request.model_dump(mode="json", exclude_none=True)
        response_payload = response.model_dump(mode="json")
        top_features = (response_payload.get("explainability") or {}).get("top_features", [])

        db_run = crud.create_prediction_run(
            db,
            request_payload=request_payload,
            response_payload=response_payload,
            model_version=model_version,
            regional_comparison=regional_comparison,
            feature_contributions=top_features,
        )
        response.prediction_run_id = db_run.prediction_run_id

        # Optionally log prediction for future analysis (background task)
        background_tasks.add_task(
            log_prediction_request,
            request=request,
            response=response,
            model_version=model_version.version_tag
        )

        return response

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction failed: {str(e)}"
        )


@router.post("/model/{version_tag}", response_model=PredictionResponse, summary="Predict yield with a specific model version")
async def predict_yield_specific_model(
    version_tag: str,
    request: PredictionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Predict crop yield using a specific model version tag.
    """
    try:
        model_version = (
            db.query(db_models.ModelVersion)
            .filter(db_models.ModelVersion.version_tag == version_tag)
            .first()
        )
        if not model_version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Model version '{version_tag}' not found."
            )

        predictor = PredictionService(db)

        county = request.county if hasattr(request, 'county') and request.county else None
        state = request.state if hasattr(request, 'state') and request.state else None
        if not county or not state or request.season is None:
            regional_comparison = None
        else:
            regional_stats = RegionalStatsService(db)
            regional_comparison = regional_stats.get_county_avg(
                crop=request.crop,
                season=request.season,
                state=state,
                county=county
            )

        # Mirror the main endpoint's enrichment so a prediction from
        # /predictions/model/{tag} produces the same numbers as
        # /predictions for the same payload — the model expects the
        # full 86-feature schema, not the lean wizard payload.
        request_features, coordinates_source, live_enrichment_metadata = _enrich_request_features(request)
        prediction_result = predictor.predict(request_features, model_version=model_version)

        explanations = {"top_features": []}
        try:
            explainer = ExplainabilityEngine(db, predictor)
            explanations = explainer.explain_prediction(
                features=prediction_result['features'],
                model_version=model_version,
                base_value=prediction_result.get('base_value', 0.0)
            )
        except Exception as explain_err:
            logger.warning(
                f"Explainability unavailable for model {model_version.version_tag}: {explain_err}",
                exc_info=True,
            )

        response = PredictionResponse(
            predicted_yield=prediction_result['predicted_yield'],
            confidence_interval=[
                prediction_result['confidence_lower'],
                prediction_result['confidence_upper']
            ],
            confidence_level=prediction_result.get('confidence_level'),
            model_version=model_version.version_tag,
            regional_comparison=regional_comparison,
            explainability={
                "top_features": [
                    FeatureContribution(
                        feature=feat['feature'],
                        value=feat['value'],
                        direction=feat['direction'],
                        importance=feat['importance']
                    ).model_dump()
                    for feat in explanations['top_features'][:5]
                ]
            },
            recommendations=None,
            coordinates_source=coordinates_source,
            enrichment_source=live_enrichment_metadata.get("source"),
            enrichment_rows=live_enrichment_metadata.get("rows"),
            enrichment_filled_fields=live_enrichment_metadata.get("filled_fields") or None,
        )

        request_payload = request.model_dump(mode="json", exclude_none=True)
        response_payload = response.model_dump(mode="json")
        top_features = (response_payload.get("explainability") or {}).get("top_features", [])

        db_run = crud.create_prediction_run(
            db,
            request_payload=request_payload,
            response_payload=response_payload,
            model_version=model_version,
            regional_comparison=regional_comparison,
            feature_contributions=top_features,
        )
        response.prediction_run_id = db_run.prediction_run_id

        background_tasks.add_task(
            log_prediction_request,
            request=request,
            response=response,
            model_version=model_version.version_tag
        )

        return response

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Prediction error for specific model {version_tag}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction failed: {str(e)}"
        )


@router.post("/all-models", response_model=MultiModelPredictionResponse, summary="Predict yield across all registered models")
async def predict_yield_all_models(
    request: PredictionRequest,
    db: Session = Depends(get_db),
):
    """
    Predict yield using every registered model version.

    Useful for model comparison in external frontends.
    Returns one entry per model with either prediction values or an error.
    """
    try:
        predictor = PredictionService(db)
        model_versions = crud.get_model_versions(db, limit=500)
        if not model_versions:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No model versions available. Register/train a model first."
            )

        # Enrich ONCE — every model sees the same payload, otherwise
        # cross-model comparisons in the multi-model view conflate
        # "different model" with "different feature fill".
        payload, _coords_src, _enrich_meta = _enrich_request_features(request)
        items: List[MultiModelPredictionItem] = []
        explainer = ExplainabilityEngine(db, predictor)
        for mv in model_versions:
            try:
                result = predictor.predict(payload, model_version=mv)
                explanations = {"top_features": []}
                try:
                    explanations = explainer.explain_prediction(
                        features=result["features"],
                        model_version=mv,
                        base_value=result.get("base_value", 0.0),
                    )
                except Exception as explain_err:
                    logger.warning(
                        f"All-model explainability unavailable for {mv.version_tag}: {explain_err}",
                        exc_info=True,
                    )

                items.append(
                    MultiModelPredictionItem(
                        model_version_id=mv.model_version_id,
                        model_version=mv.version_tag,
                        model_type=mv.model_type,
                        is_production=bool(mv.is_production),
                        predicted_yield=result["predicted_yield"],
                        confidence_interval=[
                            result["confidence_lower"],
                            result["confidence_upper"],
                        ],
                        confidence_level=result.get("confidence_level"),
                        explainability={
                            "top_features": [
                                FeatureContribution(
                                    feature=feat["feature"],
                                    value=feat["value"],
                                    direction=feat["direction"],
                                    importance=feat["importance"],
                                ).model_dump()
                                for feat in explanations.get("top_features", [])[:5]
                            ]
                        },
                        error=None,
                    )
                )
            except Exception as exc:
                logger.warning(f"All-model prediction failed for {mv.version_tag}: {exc}")
                items.append(
                    MultiModelPredictionItem(
                        model_version_id=mv.model_version_id,
                        model_version=mv.version_tag,
                        model_type=mv.model_type,
                        is_production=bool(mv.is_production),
                        predicted_yield=None,
                        confidence_interval=None,
                        explainability={"top_features": []},
                        error=str(exc),
                    )
                )

        # Production first, then version_tag for stable ordering.
        items.sort(key=lambda x: (not x.is_production, x.model_version))
        return MultiModelPredictionResponse(request=payload, predictions=items)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"All-model prediction error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"All-model prediction failed: {str(e)}"
        )


@router.post("/batch", summary="Batch predict yield")
async def batch_predict_yield(
    requests: List[PredictionRequest],
    db: Session = Depends(get_db),
):
    """
    Predict yield for multiple fields in batch.

    Accepts a list of prediction requests.
    Returns a list of predictions in the same order.
    """
    try:
        predictor = PredictionService(db)
        model_version = predictor.get_production_model()

        if not model_version:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No production model available"
            )

        results = []
        for req in requests:
            try:
                # Per-request enrichment so each row gets centroid + CSV
                # fill keyed on its own state/county/crop/variety.
                enriched_payload, _coords_src, _enrich_meta = _enrich_request_features(req)
                result = predictor.predict(enriched_payload, model_version)
                results.append(PredictionResponse(
                    predicted_yield=result['predicted_yield'],
                    confidence_interval=[
                        result['confidence_lower'],
                        result['confidence_upper']
                    ],
                    confidence_level=result.get('confidence_level'),
                    model_version=model_version.version_tag,
                    regional_comparison=None,
                    explainability=None,
                    recommendations=None,
                ).model_dump())
            except Exception as e:
                logger.error(f"Batch prediction failed for item: {e}")
                results.append({
                    "error": str(e),
                    "predicted_yield": None,
                    "confidence_interval": None,
                    "model_version": model_version.version_tag if model_version else None,
                })

        return {"predictions": results, "total": len(requests)}

    except Exception as e:
        logger.error(f"Batch prediction error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch prediction failed: {str(e)}"
        )


@router.get("/history", response_model=List[PredictionRunResponse], summary="List saved prediction runs")
async def list_prediction_runs(
    db: Session = Depends(get_db),
    limit: int = 100,
    page: int = 1,
    crop: Optional[str] = None,
    model_version_id: Optional[int] = None,
):
    """
    List persisted ad-hoc prediction runs created by prediction endpoints.
    """
    safe_limit = min(max(limit, 1), 500)
    safe_page = max(page, 1)
    skip = (safe_page - 1) * safe_limit

    runs = crud.get_prediction_runs(
        db,
        skip=skip,
        limit=safe_limit,
        crop=crop,
        model_version_id=model_version_id,
    )
    return [_serialize_prediction_run(run) for run in runs]


def _compute_scatter_metrics(points: List[Dict[str, float]]) -> Dict[str, Optional[float]]:
    """Compute the diagnostic-plot statistics that the frontend renders in
    the card header. All formulas are unweighted and use n-1 / n where
    standard for sample stats:

      R²      — 1 - SSE/SST, the coefficient of determination of
                predicted vs observed. Negative when the model is worse
                than predicting the mean.
      RMSE    — sqrt( mean( (predicted - observed)² ) ).
      MAE     — mean( |predicted - observed| ).
      bias    — mean residual (predicted - observed). Positive = the
                model systematically over-predicts.
      slope,  — ordinary-least-squares fit of `predicted = slope *
      intercept observed + intercept`. Slope of 1 + intercept of 0 means
                the model tracks the 1:1 line perfectly.
    """
    n = len(points)
    if n < 2:
        return {
            "n": n,
            "r2": None,
            "rmse": None,
            "mae": None,
            "bias": None,
            "slope": None,
            "intercept": None,
            "observed_min": None,
            "observed_max": None,
            "predicted_min": None,
            "predicted_max": None,
        }

    obs = [p["observed"] for p in points]
    pred = [p["predicted"] for p in points]
    residuals = [pred[i] - obs[i] for i in range(n)]

    obs_mean = sum(obs) / n
    pred_mean = sum(pred) / n

    sse = sum(r * r for r in residuals)
    sst = sum((o - obs_mean) ** 2 for o in obs)
    r2 = 1.0 - (sse / sst) if sst > 0 else None
    rmse = math.sqrt(sse / n)
    mae = sum(abs(r) for r in residuals) / n
    bias = sum(residuals) / n

    # OLS regression of predicted on observed.
    num = sum((obs[i] - obs_mean) * (pred[i] - pred_mean) for i in range(n))
    den = sum((obs[i] - obs_mean) ** 2 for i in range(n))
    if den > 0:
        slope = num / den
        intercept = pred_mean - slope * obs_mean
    else:
        slope = None
        intercept = None

    return {
        "n": n,
        "r2": r2,
        "rmse": rmse,
        "mae": mae,
        "bias": bias,
        "slope": slope,
        "intercept": intercept,
        "observed_min": min(obs),
        "observed_max": max(obs),
        "predicted_min": min(pred),
        "predicted_max": max(pred),
    }


@router.get(
    "/scatter",
    summary="Predicted vs observed pairs + regression metrics for a model",
)
async def get_prediction_scatter(
    db: Session = Depends(get_db),
    model_id: Optional[int] = Query(
        None,
        description="Model version id. Defaults to the production model if unset.",
    ),
    season: Optional[List[int]] = Query(
        None,
        description=(
            "Optional filter — restrict to one or more season years (repeat the "
            "query param to pass multiple, e.g. season=2023&season=2024). "
            "Helpful for matching the slice your training set was cut on."
        ),
    ),
    state: Optional[str] = Query(
        None,
        description="Optional filter — restrict to a single state (e.g. 'Kansas').",
    ),
    coverage_scope: str = Query(
        "in_distribution",
        regex="^(in_envelope|in_distribution|all)$",
        description=(
            "Scope filter for predictions:\n"
            "  - 'in_distribution' (default): rows whose categorical AND "
            "numeric inputs fall within the training distribution "
            "(state/county/variety + yield range + acres/totalN range). "
            "This is the most meaningful real-world R² — it includes "
            "production rows that look like training rows.\n"
            "  - 'in_envelope': only the exact field-seasons the model "
            "was trained on (membership in coverage.training_field_numbers). "
            "Gives an in-sample R² — useful for verifying the model fits "
            "its training data.\n"
            "  - 'all': every prediction, including out-of-distribution "
            "rows where the model has no training basis to predict well."
        ),
    ),
    limit: int = Query(
        5000,
        ge=1,
        le=20000,
        description="Hard cap on points returned. Use a smaller number for snappier scatter renders.",
    ),
):
    """Return all (predicted, observed) pairs for a given model plus the
    standard diagnostic statistics. Powers the Model Regression card on
    the Analytics → Model & Data view.

    Only includes field-seasons that have both a stored prediction for
    the requested model AND a non-null observed `yield_bu_ac`. Field-
    seasons where either side is missing are excluded so the metrics
    aren't biased by half-pairs.

    The `season` and `state` query params let callers narrow the slice
    to match their training subset, which often raises R² substantially
    (the full prediction set includes out-of-time / out-of-geography
    field-seasons that the model was never tuned on).
    """
    # Resolve the model. Fall back to the production model if no id was
    # supplied — the frontend will use this to label its initial render.
    if model_id is None:
        mv = (
            db.query(db_models.ModelVersion)
            .filter(db_models.ModelVersion.is_production.is_(True))
            .first()
        )
    else:
        mv = db.get(db_models.ModelVersion, model_id)

    if mv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No production model registered."
                if model_id is None
                else f"Model version {model_id} not found."
            ),
        )

    # Build the joined query. We always pull season_year, state, county,
    # crop, and variety alongside the value columns so the response can
    # carry them on each point (cheap; same row already joined) — that
    # lets the frontend show which slice each point belongs to in hover
    # tooltips, lets us echo the filters back without a second round-
    # trip, AND lets us apply the coverage-envelope filter without
    # needing a second query. The Crop / Variety outer joins are LEFT
    # joins so rows missing variety still show up (variety is genuinely
    # nullable in training and production).
    query = (
        db.query(
            db_models.ModelPrediction.field_season_id,
            db_models.ModelPrediction.predicted_yield,
            db_models.FieldSeason.yield_bu_ac,
            db_models.Field.field_number,
            db_models.Field.state,
            db_models.Field.county,
            db_models.Field.acres,
            db_models.Crop.crop_name_en,
            db_models.Variety.variety_name_en,
            db_models.FieldSeason.totalN_per_ac,
            db_models.FieldSeason.season_id,
            db_models.Season.season_year,
        )
        .join(
            db_models.FieldSeason,
            db_models.ModelPrediction.field_season_id == db_models.FieldSeason.field_season_id,
        )
        .join(
            db_models.Field,
            db_models.FieldSeason.field_id == db_models.Field.field_id,
        )
        .join(
            db_models.Crop,
            db_models.FieldSeason.crop_id == db_models.Crop.crop_id,
            isouter=True,
        )
        .join(
            db_models.Variety,
            db_models.FieldSeason.variety_id == db_models.Variety.variety_id,
            isouter=True,
        )
        .join(
            db_models.Season,
            db_models.FieldSeason.season_id == db_models.Season.season_id,
        )
        .filter(
            db_models.ModelPrediction.model_version_id == mv.model_version_id,
            db_models.ModelPrediction.predicted_yield.is_not(None),
            db_models.FieldSeason.yield_bu_ac.is_not(None),
        )
    )

    if season:
        query = query.filter(db_models.Season.season_year.in_(season))
    if state:
        # Postgres ILIKE keeps the filter case-insensitive so the UI can
        # pass "kansas" or "Kansas" interchangeably.
        query = query.filter(db_models.Field.state.ilike(state))

    # Pull a bit more than `limit` from the DB so the coverage filter can
    # prune down to limit without truncating the in-scope subset. Capped
    # to limit*3 (and the hard 20k upper bound). 'all' skips the multiplier.
    db_limit = limit if coverage_scope == "all" else min(limit * 3, 20000)
    rows = query.limit(db_limit).all()

    # Resolve the coverage envelope once per request. Cached by model_id
    # so the second-and-onward requests for the same model skip the
    # disk read and JSON parse.
    envelope = _coverage_envelope(mv.model_version_id)
    apply_coverage = coverage_scope != "all" and envelope.get("loaded")

    # Pick the row-check function based on the requested scope. The two
    # tiers measure different things: tier-1 is exact training-set
    # membership (in-sample); tier-2 is distributional similarity
    # (similar-shape, out-of-sample). All-mode just keeps everything.
    def _row_passes_scope(state, county, crop, variety, observed, acres, total_n, field_number):
        if coverage_scope == "in_envelope":
            return _row_in_envelope(envelope, state, county, crop, variety, field_number=field_number)
        if coverage_scope == "in_distribution":
            return _row_in_distribution(
                envelope, state, county, crop, variety,
                yield_observed=observed, acres=acres, total_n=total_n,
            )
        return True  # 'all'

    # Classify each row into one of three tiers, independent of the
    # current scope filter. The Analytics tab's in-card Table view uses
    # this to render a tier badge per row so a user looking at the
    # "All predictions" view can still see at a glance which rows are
    # in-training-set vs in-distribution vs out-of-distribution.
    def _row_tier(state, county, crop, variety, observed, acres, total_n, field_number):
        if not envelope.get("loaded"):
            return "unknown"
        if _row_in_envelope(envelope, state, county, crop, variety, field_number=field_number):
            return "training_set"
        if _row_in_distribution(
            envelope, state, county, crop, variety,
            yield_observed=observed, acres=acres, total_n=total_n,
        ):
            return "in_distribution"
        return "out_of_distribution"

    points: List[Dict[str, Any]] = []
    out_of_scope_count = 0
    for (
        fs_id,
        predicted,
        observed,
        field_number,
        field_state,
        field_county,
        field_acres,
        crop_name,
        variety_name,
        total_n,
        season_id,
        season_year,
    ) in rows:
        try:
            p = float(predicted)
            o = float(observed)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(p) and math.isfinite(o)):
            continue

        acres_value = float(field_acres) if field_acres is not None else None
        total_n_value = float(total_n) if total_n is not None else None
        passes = _row_passes_scope(
            field_state, field_county, crop_name, variety_name,
            o, acres_value, total_n_value, field_number,
        )
        if apply_coverage and not passes:
            out_of_scope_count += 1
            continue
        if len(points) >= limit:
            if apply_coverage:
                continue
            break

        # Tier is independent of which scope is active — useful for the
        # table view's tier badge so a user on "All predictions" still
        # sees at a glance which rows are training-set vs similar vs out.
        tier = _row_tier(
            field_state, field_county, crop_name, variety_name,
            o, acres_value, total_n_value, field_number,
        )

        points.append(
            {
                "field_season_id": fs_id,
                "field_number": field_number,
                "state": field_state,
                "county": field_county,
                "crop": crop_name,
                "variety": variety_name,
                "in_coverage": passes,
                "coverage_tier": tier,
                "season_id": season_id,
                "season_year": season_year,
                "observed": o,
                "predicted": p,
                "residual": p - o,
            }
        )

    metrics = _compute_scatter_metrics(points)

    # Distinct seasons + states across the unfiltered prediction set for
    # this model — used by the frontend to populate the filter dropdowns
    # with only values that have at least one matching point. This is one
    # extra lightweight query but it means the dropdowns can't offer
    # impossible combinations.
    available = (
        db.query(
            db_models.Season.season_year,
            db_models.Field.state,
        )
        .join(
            db_models.FieldSeason,
            db_models.FieldSeason.season_id == db_models.Season.season_id,
        )
        .join(
            db_models.Field,
            db_models.FieldSeason.field_id == db_models.Field.field_id,
        )
        .join(
            db_models.ModelPrediction,
            db_models.ModelPrediction.field_season_id == db_models.FieldSeason.field_season_id,
        )
        .filter(
            db_models.ModelPrediction.model_version_id == mv.model_version_id,
            db_models.ModelPrediction.predicted_yield.is_not(None),
            db_models.FieldSeason.yield_bu_ac.is_not(None),
        )
        .distinct()
        .all()
    )
    available_seasons = sorted({y for y, _ in available if y is not None})
    available_states = sorted({s for _, s in available if s})

    # Compute the totals for the coverage toggle's "1,002 of 3,435 fields"
    # caption — these are pre-other-filter counts (season/state filters
    # still apply, so the totals make sense in context). One light query
    # per scope; the in-envelope tally requires per-row checking so we
    # piggyback off the already-pulled rows when scoping is on.
    if envelope.get("loaded"):
        total_query = (
            db.query(
                db_models.Field.field_number,
                db_models.Field.state,
                db_models.Field.county,
                db_models.Field.acres,
                db_models.Crop.crop_name_en,
                db_models.Variety.variety_name_en,
                db_models.FieldSeason.totalN_per_ac,
                db_models.FieldSeason.yield_bu_ac,
            )
            .join(
                db_models.FieldSeason,
                db_models.FieldSeason.field_id == db_models.Field.field_id,
            )
            .join(
                db_models.ModelPrediction,
                db_models.ModelPrediction.field_season_id == db_models.FieldSeason.field_season_id,
            )
            .join(
                db_models.Crop,
                db_models.FieldSeason.crop_id == db_models.Crop.crop_id,
                isouter=True,
            )
            .join(
                db_models.Variety,
                db_models.FieldSeason.variety_id == db_models.Variety.variety_id,
                isouter=True,
            )
            .join(
                db_models.Season,
                db_models.FieldSeason.season_id == db_models.Season.season_id,
            )
            .filter(
                db_models.ModelPrediction.model_version_id == mv.model_version_id,
                db_models.ModelPrediction.predicted_yield.is_not(None),
                db_models.FieldSeason.yield_bu_ac.is_not(None),
            )
        )
        if season:
            total_query = total_query.filter(db_models.Season.season_year.in_(season))
        if state:
            total_query = total_query.filter(db_models.Field.state.ilike(state))
        total_rows = total_query.all()
        total_predictions = len(total_rows)
        in_envelope_total = sum(
            1
            for (fn, st, co, ac, cr, vr, tn, yo) in total_rows
            if _row_in_envelope(envelope, st, co, cr, vr, field_number=fn)
        )
        # Tier-2 count: rows whose inputs match the training distribution.
        # Casting numerics to float defensively because the DB column types
        # may surface as Decimal/None and the helper does its own None
        # checks — but unconditional float() would crash on None.
        in_distribution_total = sum(
            1
            for (fn, st, co, ac, cr, vr, tn, yo) in total_rows
            if _row_in_distribution(
                envelope, st, co, cr, vr,
                yield_observed=float(yo) if yo is not None else None,
                acres=float(ac) if ac is not None else None,
                total_n=float(tn) if tn is not None else None,
            )
        )
    else:
        total_predictions = None
        in_envelope_total = None
        in_distribution_total = None

    return {
        "model_version": {
            "model_version_id": mv.model_version_id,
            "version_tag": mv.version_tag,
            "model_type": mv.model_type,
            "is_production": bool(mv.is_production),
        },
        "filters_applied": {
            "season": list(season) if season else None,
            "state": state,
            "coverage_scope": coverage_scope,
        },
        "available_filters": {
            "seasons": available_seasons,
            "states": available_states,
        },
        "coverage": {
            # null when the model has no coverage.json — frontend treats
            # that as "no scoping available, hide the toggle".
            "available": bool(envelope.get("loaded")),
            "total_predictions": total_predictions,
            # in_envelope_total = rows in the exact training set (tier 1).
            # in_distribution_total = rows in the training distribution
            # (tier 2 — geographic + numeric ranges + yield range).
            # tier 2 is always >= tier 1 because every training row is
            # by definition in its own distribution.
            "in_envelope_total": in_envelope_total,
            "in_distribution_total": in_distribution_total,
            "out_of_scope_filtered": out_of_scope_count if apply_coverage else 0,
        },
        "metrics": metrics,
        "points": points,
        "truncated": len(points) >= limit,
    }


# Helper function for logging
def log_prediction_request(
    request: PredictionRequest,
    response: PredictionResponse,
    model_version: str,
):
    """
    Log prediction requests for monitoring and future training.
    This can be expanded to store in a predictions_log table.
    """
    logger.info(
        f"Prediction made: crop={request.crop}, variety={request.variety}, "
        f"season={request.season}, model={model_version}, "
        f"predicted_yield={response.predicted_yield}"
    )
    # Future: Store in database

"""
Nutrition AI Dashboard - Streamlit Frontend (MVP)
"""
import streamlit as st
import pandas as pd
import requests
import plotly.express as px
from datetime import datetime
import os

st.set_page_config(
    page_title="Nutrition AI",
    page_icon="🌱",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Hide Streamlit header, deploy widget; narrow sidebar
st.markdown("""
<style>
    [data-testid="stSidebar"] { width: 220px !important; min-width: 220px !important; }
    header[data-testid="stHeader"] { display: none !important; }
    #stDeployButton { display: none !important; }
    .stDeployButton { display: none !important; }
    #MainMenu { visibility: hidden; }
    /* Slight space above header for breathing room */
    section.main .block-container { padding-top: 0.5rem !important; }
    .main-header { font-size: 1.75rem; font-weight: 600; color: #2E7D32;
        margin: -1rem -1rem 1rem -1rem; margin-top: 0.75rem !important; padding: 0.75rem 1.5rem;
        display: flex; align-items: center; gap: 0.5rem;
        background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
        border-bottom: 2px solid #2E7D32; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .prediction-box { background-color: #e8f5e9; padding: 1rem; border-radius: 0.5rem; margin-top: 1rem; }
</style>
""", unsafe_allow_html=True)

st.markdown('<div class="main-header"><span>🌱</span><span>Nutrition AI</span></div>', unsafe_allow_html=True)

API_URL = os.getenv("API_URL", "http://localhost:8001")


@st.cache_data(ttl=300)
def get_overview():
    try:
        r = requests.get(f"{API_URL}/api/v1/fields/overview", timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        st.error(f"Failed to fetch overview: {e}")
        return {}


def get_filtered_fields(crop=None, variety=None, season=None, state=None, min_acres=None, max_acres=None, has_prediction=None, limit=500):
    params = {"page": 1, "limit": limit}
    if crop: params["crop"] = crop
    if variety: params["variety"] = variety
    if season: params["season"] = season
    if state: params["state"] = state
    if min_acres is not None: params["min_acres"] = min_acres
    if max_acres is not None: params["max_acres"] = max_acres
    if has_prediction is not None: params["has_prediction"] = has_prediction
    try:
        r = requests.get(f"{API_URL}/api/v1/fields", params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        st.error(f"Failed to fetch data: {e}")
        return {"data": [], "total": 0, "page": 1, "limit": limit, "pages": 0}


@st.cache_data(ttl=300)
def get_field_details(field_season_id: int):
    try:
        r = requests.get(f"{API_URL}/api/v1/fields/{field_season_id}", timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def get_prediction_request(payload: dict):
    try:
        r = requests.post(f"{API_URL}/api/v1/predict", json=payload, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        st.error(f"Prediction failed: {e}")
        return None


@st.cache_data(ttl=60)
def get_ui_form_config(form_key: str):
    try:
        r = requests.get(f"{API_URL}/admin/api/ui-config/public", params={"form_key": form_key}, timeout=10)
        r.raise_for_status()
        data = r.json()
        return data.get("config", {})
    except Exception:
        return {}


def render_custom_fields(custom_fields, key_prefix: str):
    values = {}
    missing_required = []
    if not custom_fields:
        return values, missing_required

    st.markdown("**Additional Fields**")
    for idx, field in enumerate(custom_fields):
        field_key = str(field.get("field_key", f"custom_{idx}"))
        label = str(field.get("label", field_key))
        field_type = str(field.get("type", "text")).lower()
        payload_key = str(field.get("payload_key") or field_key)
        required = bool(field.get("required", False))
        help_text = field.get("help_text") or None
        default = field.get("default")
        widget_key = f"{key_prefix}_{field_key}"
        value = None

        if field_type == "select":
            options = field.get("options") or []
            options = [str(x) for x in options]
            if options:
                default_idx = 0
                if default in options:
                    default_idx = options.index(default)
                value = st.selectbox(
                    f"{label}{' *' if required else ''}",
                    options=options,
                    index=default_idx,
                    key=widget_key,
                    help=help_text,
                )
            else:
                value = st.text_input(f"{label}{' *' if required else ''}", value=str(default or ""), key=widget_key, help=help_text)
        elif field_type == "number":
            try:
                default_num = float(default) if default is not None else 0.0
            except (TypeError, ValueError):
                default_num = 0.0
            value = st.number_input(f"{label}{' *' if required else ''}", value=default_num, key=widget_key, help=help_text)
        elif field_type == "boolean":
            value = st.checkbox(f"{label}{' *' if required else ''}", value=bool(default), key=widget_key, help=help_text)
        else:
            value = st.text_input(f"{label}{' *' if required else ''}", value=str(default or ""), key=widget_key, help=help_text)

        if required and (value is None or value == ""):
            missing_required.append(label)
        values[payload_key] = value

    return values, missing_required


if "selected_field_id" not in st.session_state:
    st.session_state.selected_field_id = None
if "filters" not in st.session_state:
    st.session_state.filters = {}

# Sidebar
with st.sidebar:
    st.header("🔍 Filters")
    overview = get_overview()
    seasons_available = overview.get("seasons_available", [2024, 2025])
    crops_available = overview.get("crops_available", [])
    crop_names = [c.get("crop_name", c) if isinstance(c, dict) else str(c) for c in crops_available]
    if not crop_names:
        crop_names = ["Sorghum", "Wheat, Hard Winter", "Corn"]

    selected_seasons = st.multiselect("Season", options=sorted(seasons_available, reverse=True) or [2024, 2025],
        default=[max(seasons_available)] if seasons_available else [2025], key="season_filter")
    selected_crop = st.selectbox("Crop", options=crop_names, key="crop_filter")
    states_available = overview.get("states_available", [])
    selected_state = st.selectbox("State", options=[None] + (states_available or []), key="state_filter")

    st.session_state.filters = {
        "season": selected_seasons if selected_seasons else None,
        "crop": selected_crop if selected_crop else None,
        "state": selected_state if selected_state else None,
    }

    st.markdown("---")
    st.subheader("Export")
    if st.button("Export CSV"):
        try:
            resp = requests.get(f"{API_URL}/api/v1/export/csv", params=st.session_state.get("filters", {}), timeout=30)
            resp.raise_for_status()
            st.download_button("⬇️ Download", data=resp.content, file_name=f"nutrition_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv", mime="text/csv", key="dl_csv")
        except Exception as e:
            st.error(str(e))

    total_records = overview.get("total_field_seasons", 0)
    st.caption(f"Total records: {total_records:,}")

# Main tabs
tab_overview, tab_table, tab_map, tab_analytics, tab_predict, tab_upload = st.tabs([
    "📊 Overview", "📋 Field Table", "🗺️ Map View", "📈 Analytics", "🔮 Predict", "📤 Data Upload"
])

# Overview
with tab_overview:
    st.header("Project Overview")
    st.caption("Summary metrics (field-seasons, crops, seasons), observed yield range, and prediction statistics (coverage, avg predicted yield).")
    st.markdown("**Nutrition AI** - Agricultural Yield Prediction Platform")
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Field-Seasons", f"{overview.get('total_field_seasons', 0):,}")
    with col2:
        st.metric("Fields", f"{overview.get('total_fields', 0):,}")
    with col3:
        st.metric("Seasons", len(overview.get("seasons_available", [])))
    with col4:
        st.metric("Crops", len(overview.get("crops_available", [])))
    yield_range = overview.get("yield_range", {})
    if yield_range and (yield_range.get("min") or yield_range.get("max")):
        st.markdown("---")
        c1, c2, c3 = st.columns(3)
        with c1: st.metric("Min Yield", f"{yield_range.get('min', 0):.1f} bu/ac")
        with c2: st.metric("Max Yield", f"{yield_range.get('max', 0):.1f} bu/ac")
        with c3: st.metric("Avg Yield", f"{yield_range.get('avg', 0):.1f} bu/ac")

    # Prediction statistics (from already predicted data in the system)
    st.markdown("---")
    st.subheader("Prediction statistics")
    st.caption("Aggregates from stored model predictions in the system.")
    pred_stats = overview.get("prediction_stats") or {}
    total_fs = overview.get("total_field_seasons", 0) or 1
    with_pred = pred_stats.get("field_seasons_with_predictions", 0)
    coverage_pct = (100.0 * with_pred / total_fs) if total_fs else 0
    p1, p2, p3, p4, p5 = st.columns(5)
    with p1:
        st.metric("Field-seasons with predictions", f"{with_pred:,}")
    with p2:
        st.metric("Coverage", f"{coverage_pct:.1f}%")
    with p3:
        st.metric("Total predictions", f"{pred_stats.get('total_predictions', 0):,}")
    with p4:
        st.metric("Avg predicted yield", f"{pred_stats.get('predicted_yield_avg', 0):.1f} bu/ac")
    with p5:
        st.metric("Predicted yield range", f"{pred_stats.get('predicted_yield_min', 0):.1f} – {pred_stats.get('predicted_yield_max', 0):.1f} bu/ac")

# Field Table
with tab_table:
    st.header("Field-Season Records")
    st.caption("Sortable table of field-season records (crop, variety, season, location, observed/predicted yield, N/P/K) filtered by sidebar.")
    result = get_filtered_fields(
        crop=st.session_state.filters.get("crop"),
        season=st.session_state.filters.get("season"),
        state=st.session_state.filters.get("state"),
        limit=500,
    )
    if result.get("data"):
        df = pd.DataFrame(result["data"])
        st.dataframe(df, use_container_width=True)
    else:
        st.info("No records match filters.")

# Map
with tab_map:
    st.header("Geographic Distribution")
    st.caption("Map of field locations (lat/long) with hover for crop, season, and yield; uses same filtered data as Field Table.")
    if result.get("data"):
        df = pd.DataFrame(result["data"])
        if "lat" in df.columns and "long" in df.columns:
            df_map = df.dropna(subset=["lat", "long"])
            if len(df_map) > 0:
                fig = px.scatter_mapbox(df_map, lat="lat", lon="long", hover_data=["crop", "season", "yield_bu_ac"], zoom=3)
                fig.update_layout(mapbox_style="open-street-map")
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.info("No coordinates available.")
        else:
            st.info("No lat/long in data.")
    else:
        st.info("No data to map.")

# Analytics
with tab_analytics:
    st.header("Analytics & Comparisons")
    st.caption("Yield distribution histogram and Predicted vs Observed scatter plot from filtered field-season data.")
    result_an = get_filtered_fields(
        crop=st.session_state.filters.get("crop"),
        season=st.session_state.filters.get("season"),
        state=st.session_state.filters.get("state"),
        limit=500,
    )
    if result_an.get("data"):
        df = pd.DataFrame(result_an["data"])
        col1, col2 = st.columns(2)
        with col1:
            if "yield_bu_ac" in df.columns and df["yield_bu_ac"].notna().any():
                fig = px.histogram(df.dropna(subset=["yield_bu_ac"]), x="yield_bu_ac", nbins=50, title="Yield Distribution")
                st.plotly_chart(fig, use_container_width=True)
        with col2:
            if "yield_bu_ac" in df.columns and "predicted_yield" in df.columns:
                valid = df.dropna(subset=["yield_bu_ac", "predicted_yield"])
                if len(valid) > 0:
                    fig = px.scatter(valid, x="yield_bu_ac", y="predicted_yield", trendline="ols", title="Predicted vs Observed")
                    st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No data to analyze.")

# Predict
with tab_predict:
    st.header("🔮 Yield Prediction Tool")
    st.caption("Select an existing field or enter crop, location, season, N/P/K manually; submit to get predicted yield, confidence interval, and key factors.")
    prediction_form_cfg = get_ui_form_config("prediction")
    prediction_dropdowns = prediction_form_cfg.get("dropdowns", {}) if isinstance(prediction_form_cfg, dict) else {}
    prediction_custom_fields = prediction_form_cfg.get("custom_fields", []) if isinstance(prediction_form_cfg, dict) else []
    try:
        fields_resp = requests.get(f"{API_URL}/api/v1/fields?limit=500", timeout=10)
        field_options = []
        if fields_resp.status_code == 200:
            fd = fields_resp.json()
            for f in fd.get("data", []):
                label = f"Field {f.get('field_number', 'N/A')} - {f.get('crop', 'N/A')} - {f.get('season', 'N/A')}"
                field_options.append((label, f))
        if field_options:
            chosen = st.selectbox("Or select existing field", options=[x[0] for x in field_options], index=None, placeholder="Choose...")
            if chosen:
                sel = [x[1] for x in field_options if x[0] == chosen][0]
                st.json(sel)
    except Exception:
        pass

    with st.form("pred_form"):
        c1, c2, c3 = st.columns(3)
        with c1:
            pred_crop_options = prediction_dropdowns.get("crop") if isinstance(prediction_dropdowns.get("crop"), list) and prediction_dropdowns.get("crop") else crop_names
            pred_crop = st.selectbox("Crop", options=pred_crop_options, index=0)
            pred_variety = st.text_input("Variety (optional)")
            pred_acres = st.number_input("Acres", min_value=0.1, value=50.0, step=1.0)
        with c2:
            pred_lat = st.number_input("Latitude", value=37.5, format="%.6f", min_value=-90.0, max_value=90.0)
            pred_long = st.number_input("Longitude", value=-99.5, format="%.6f", min_value=-180.0, max_value=180.0)
            pred_season = st.number_input("Season", min_value=2000, max_value=2030, value=2025)
        with c3:
            pred_n = st.number_input("Total N (lb/ac)", min_value=0.0, value=60.0, step=5.0)
            pred_p = st.number_input("Total P (lb/ac)", min_value=0.0, value=40.0, step=5.0)
            pred_k = st.number_input("Total K (lb/ac)", min_value=0.0, value=30.0, step=5.0)
        pred_water = st.number_input("Water Applied (mm)", min_value=0.0, value=0.0, step=10.0)
        pred_county = st.text_input("County")
        pred_state_options = prediction_dropdowns.get("state") if isinstance(prediction_dropdowns.get("state"), list) else []
        if pred_state_options:
            pred_state = st.selectbox("State", options=pred_state_options, index=0)
        else:
            pred_state = st.text_input("State")

        custom_pred_values, missing_custom_pred = render_custom_fields(prediction_custom_fields, "prediction_custom")

        if st.form_submit_button("🔮 Predict Yield"):
            if missing_custom_pred:
                st.error(f"Missing required additional fields: {', '.join(missing_custom_pred)}")
                st.stop()
            payload = {
                "crop": pred_crop, "variety": pred_variety or None, "acres": pred_acres,
                "lat": pred_lat, "long": pred_long, "season": pred_season,
                "totalN_per_ac": pred_n, "totalP_per_ac": pred_p, "totalK_per_ac": pred_k,
                "water_applied_mm": pred_water if pred_water > 0 else None,
                "county": pred_county or None, "state": pred_state or None,
            }
            payload.update({k: v for k, v in custom_pred_values.items() if v is not None and v != ""})
            with st.spinner("Predicting..."):
                res = get_prediction_request(payload)
            if res:
                st.success(f"**Predicted Yield:** {res.get('predicted_yield', 0):.1f} bu/ac")
                if res.get("confidence_interval"):
                    st.info(f"95% CI: [{res['confidence_interval'][0]:.1f}, {res['confidence_interval'][1]:.1f}]")
                if res.get("explainability"):
                    st.subheader("Key factors")
                    for feat in res["explainability"][:5]:
                        st.write(feat)

# Data Upload
with tab_upload:
    st.header("📤 Data Upload & Management")
    st.caption("CSV upload (preview + ingest), manual entry form, and recent ingestion logs.")
    tab_csv, tab_form = st.tabs(["📤 CSV Upload", "📝 Manual Entry"])
    with tab_csv:
        uploaded_file = st.file_uploader("Choose CSV", type=["csv"])
        if uploaded_file:
            try:
                df_preview = pd.read_csv(uploaded_file, nrows=5)
                st.dataframe(df_preview)
                uploaded_file.seek(0)
                full = pd.read_csv(uploaded_file)
                st.metric("Rows", len(full))
                if st.button("🚀 Start Ingestion"):
                    with st.spinner("Uploading..."):
                        try:
                            r = requests.post(f"{API_URL}/api/v1/data/upload", files={"file": (uploaded_file.name, uploaded_file.getvalue(), "text/csv")}, timeout=300)
                            if r.status_code == 200:
                                st.success("Ingestion completed!")
                                st.json(r.json())
                            else:
                                st.error(r.text)
                        except Exception as e:
                            st.error(str(e))
            except Exception as e:
                st.error(f"Error reading CSV: {e}")
    with tab_form:
        st.markdown("Add a single field-season record by filling the form below.")
        manual_form_cfg = get_ui_form_config("manual_entry")
        manual_dropdowns = manual_form_cfg.get("dropdowns", {}) if isinstance(manual_form_cfg, dict) else {}
        manual_custom_fields = manual_form_cfg.get("custom_fields", []) if isinstance(manual_form_cfg, dict) else []
        manual_crop_options = manual_dropdowns.get("crop_name_en") if isinstance(manual_dropdowns.get("crop_name_en"), list) and manual_dropdowns.get("crop_name_en") else ["Wheat, Hard Winter", "Corn", "Sorghum", "Fallow", "Other"]
        manual_state_options = manual_dropdowns.get("state") if isinstance(manual_dropdowns.get("state"), list) and manual_dropdowns.get("state") else ["Kansas", "Nebraska", "Oklahoma", "Texas", "Colorado", "Other"]
        manual_type_options = manual_dropdowns.get("type") if isinstance(manual_dropdowns.get("type"), list) and manual_dropdowns.get("type") else ["Manual Entry"]
        manual_status_options = manual_dropdowns.get("status") if isinstance(manual_dropdowns.get("status"), list) and manual_dropdowns.get("status") else ["Completed"]
        with st.form("manual_entry_form"):
            c1, c2 = st.columns(2)
            with c1:
                field_id = st.number_input("Field ID *", min_value=1, step=1)
                crop_type = st.selectbox("Crop *", manual_crop_options)
                variety = st.text_input("Variety")
                acres = st.number_input("Acres *", min_value=0.1, step=0.01, value=50.0, format="%.2f")
                grower_id = st.number_input("Grower ID *", min_value=1, step=1, value=1)
            with c2:
                season_year = st.number_input("Season year *", min_value=2010, max_value=2030, value=2024)
                job_id = st.number_input("Job ID *", min_value=1, step=1, value=1)
                start_date = st.date_input("Start date", value=datetime.now().date())
                end_date = st.date_input("End date", value=datetime.now().date())
                county = st.text_input("County")
                state = st.selectbox("State", manual_state_options)
            op1, op2 = st.columns(2)
            with op1:
                op_type = st.selectbox("Operation Type", manual_type_options, index=0)
            with op2:
                op_status = st.selectbox("Status", manual_status_options, index=0)
            lat = st.number_input("Latitude", value=37.5, format="%.6f", min_value=-90.0, max_value=90.0)
            long = st.number_input("Longitude", value=-99.5, format="%.6f", min_value=-180.0, max_value=180.0)
            yield_bu_ac = st.number_input("Yield (bu/ac)", min_value=0.0, value=0.0, step=0.1, format="%.1f")
            total_n = st.number_input("Total N per acre (lb)", min_value=0.0, value=0.0, step=0.1, format="%.1f")
            total_p = st.number_input("Total P per acre (lb)", min_value=0.0, value=0.0, step=0.1, format="%.1f")
            total_k = st.number_input("Total K per acre (lb)", min_value=0.0, value=0.0, step=0.1, format="%.1f")
            custom_manual_values, missing_custom_manual = render_custom_fields(manual_custom_fields, "manual_custom")
            if st.form_submit_button("Submit field data"):
                if missing_custom_manual:
                    st.error(f"Missing required additional fields: {', '.join(missing_custom_manual)}")
                    st.stop()
                payload = {
                    "field_id": field_id,
                    "crop_name_en": crop_type,
                    "variety_name_en": variety or None,
                    "acres": acres,
                    "grower": grower_id,
                    "season": season_year,
                    "job_id": job_id,
                    "start": start_date.isoformat() + "T00:00:00.000000+00:00",
                    "end": end_date.isoformat() + "T00:00:00.000000+00:00",
                    "type": op_type,
                    "status": op_status,
                    "state": state,
                    "county": county or None,
                    "lat": lat,
                    "long": long,
                    "yield_bu_ac": yield_bu_ac if yield_bu_ac else None,
                    "totalN_per_ac": total_n if total_n else None,
                    "totalP_per_ac": total_p if total_p else None,
                    "totalK_per_ac": total_k if total_k else None,
                    "filenames": "manual_entry.csv",
                }
                payload.update({k: v for k, v in custom_manual_values.items() if v is not None and v != ""})
                try:
                    r = requests.post(f"{API_URL}/api/v1/manual-entry/manual-entry", json=payload, timeout=30)
                    if r.status_code == 200:
                        st.success("Field data submitted successfully.")
                        st.json(r.json())
                    else:
                        st.error(f"Failed: {r.status_code} — {r.text}")
                except Exception as e:
                    st.error(str(e))

    st.subheader("Recent Ingestion Logs")
    try:
        logs_r = requests.get(f"{API_URL}/api/v1/data/ingestion/logs?limit=10", timeout=10)
        if logs_r.status_code == 200:
            logs = logs_r.json()
            for log in logs:
                with st.expander(f"{log.get('source_filename', '')} - {log.get('status', '')}"):
                    st.write(log)
        else:
            st.warning("Could not load logs.")
    except Exception as e:
        st.error(str(e))

st.caption("Nutrition AI v1.0 | Agricultural yield prediction")

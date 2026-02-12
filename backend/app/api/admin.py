"""
Admin panel router and control APIs.
"""
from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import crud, models
from app.database.session import SessionLocal, get_db
from app.ml.predictor import PredictionService
from app.ml.trainer import ModelTrainer
from app.services.ui_config import (
    add_dropdown_option,
    delete_custom_field,
    get_form_config,
    load_ui_config,
    remove_dropdown_option,
    upsert_custom_field,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class TrainJobRequest(BaseModel):
    model_type: str = Field(default="lightgbm", pattern="^(lightgbm|xgboost|random_forest)$")
    start_season: int = Field(default=2018, ge=1900, le=2100)
    end_season: int = Field(default=2024, ge=1900, le=2100)
    test_size: float = Field(default=0.2, ge=0.1, le=0.5)
    random_seed: int = Field(default=42)
    set_production: bool = Field(default=True)


class SetProductionRequest(BaseModel):
    version_id: int


class BackfillJobRequest(BaseModel):
    batch_size: int = Field(default=1000, ge=10, le=10000)


class UiDropdownOptionRequest(BaseModel):
    form_key: str = Field(pattern="^(manual_entry|prediction)$")
    field_key: str = Field(min_length=1)
    option: str = Field(min_length=1)


class UiCustomFieldRequest(BaseModel):
    form_key: str = Field(pattern="^(manual_entry|prediction)$")
    field_key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    type: str = Field(default="text", pattern="^(text|number|select|boolean)$")
    required: bool = False
    payload_key: Optional[str] = None
    help_text: Optional[str] = None
    default: Optional[Any] = None
    options: Optional[list[str]] = None


class UiCustomFieldDeleteRequest(BaseModel):
    form_key: str = Field(pattern="^(manual_entry|prediction)$")
    field_key: str = Field(min_length=1)


_JOBS: Dict[str, Dict[str, Any]] = {}
_JOBS_LOCK = Lock()


ADMIN_HTML = """
<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>Nutrition AI Admin</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --panel: #ffffff;
      --ink: #0f172a;
      --muted: #64748b;
      --line: #e2e8f0;
      --brand: #166534;
      --brand-soft: #ecfdf3;
      --ok: #166534;
      --warn: #9a3412;
      --bad: #991b1b;
      --mono: ui-monospace, Menlo, Consolas, monospace;
      --sans: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--ink);
      background: radial-gradient(circle at 10% 10%, #eefcf2 0%, var(--bg) 35%, var(--bg) 100%);
    }

    .shell {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 14px;
      padding: 14px 16px;
    }

    .title {
      font-size: 22px;
      margin: 0;
      color: var(--brand);
    }

    .subtitle {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
    }

    .auth {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 12px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      min-width: 0;
    }

    .kpi { grid-column: span 3; }
    .wide { grid-column: span 8; }
    .side { grid-column: span 4; }
    .full { grid-column: span 12; }

    .kpi .label {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .kpi .value {
      font-size: 26px;
      font-weight: 700;
    }

    h2 {
      margin: 0 0 10px;
      font-size: 17px;
    }

    .muted { color: var(--muted); font-size: 12px; }

    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 8px;
    }

    input, select, button {
      border-radius: 8px;
      border: 1px solid var(--line);
      padding: 8px 10px;
      font-size: 13px;
      background: #fff;
      color: var(--ink);
    }

    input, select { min-width: 120px; }

    button {
      cursor: pointer;
      background: var(--brand);
      color: #fff;
      border-color: var(--brand);
      font-weight: 600;
    }

    button.alt {
      background: #fff;
      color: var(--ink);
      border-color: var(--line);
      font-weight: 500;
    }

    button.warn {
      background: #c2410c;
      border-color: #c2410c;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th, td {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-weight: 600;
      background: #f8fafc;
      position: sticky;
      top: 0;
    }

    .status {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
    }

    .status.running { background: #fef9c3; color: #854d0e; }
    .status.completed { background: #dcfce7; color: #166534; }
    .status.failed { background: #fee2e2; color: #991b1b; }
    .status.queued { background: #dbeafe; color: #1e40af; }

    .log {
      font-family: var(--mono);
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 10px;
      padding: 10px;
      max-height: 180px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.35;
      white-space: pre-wrap;
    }

    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 7px;
      background: var(--brand-soft);
      color: var(--brand);
      font-size: 11px;
      font-weight: 700;
      margin-right: 6px;
    }

    .hint {
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    .jsonbox {
      font-family: var(--mono);
      font-size: 12px;
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      margin-top: 10px;
    }

    @media (max-width: 980px) {
      .kpi, .wide, .side, .full { grid-column: span 12; }
      .header { align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class=\"shell\">
    <div class=\"header\">
      <div>
        <h1 class=\"title\">Nutrition AI Admin Control Plane</h1>
        <p class=\"subtitle\">Train models, promote deployments, monitor jobs, and operate data workflows from one place.</p>
      </div>
      <div class=\"auth\">
        <span class=\"muted\" id=\"authMode\"></span>
        <input id=\"adminKey\" placeholder=\"X-Admin-Key\" type=\"password\" />
        <button class=\"alt\" id=\"saveKeyBtn\">Save Key</button>
        <button id=\"refreshBtn\">Refresh</button>
      </div>
    </div>

    <div class=\"grid\">
      <div class=\"card kpi\"><div class=\"label\">Field Seasons</div><div class=\"value\" id=\"kpiFieldSeasons\">-</div></div>
      <div class=\"card kpi\"><div class=\"label\">Predictions</div><div class=\"value\" id=\"kpiPredictions\">-</div></div>
      <div class=\"card kpi\"><div class=\"label\">Model Versions</div><div class=\"value\" id=\"kpiModels\">-</div></div>
      <div class=\"card kpi\"><div class=\"label\">Production Model</div><div class=\"value\" id=\"kpiProduction\">-</div></div>

      <div class=\"card wide\">
        <h2>Model Training and Deployment</h2>
        <div class=\"row\">
          <select id=\"trainModelType\">
            <option value=\"lightgbm\">lightgbm</option>
            <option value=\"xgboost\">xgboost</option>
            <option value=\"random_forest\">random_forest</option>
          </select>
          <input id=\"trainStartSeason\" type=\"number\" value=\"2018\" placeholder=\"Start Season\" />
          <input id=\"trainEndSeason\" type=\"number\" value=\"2024\" placeholder=\"End Season\" />
          <input id=\"trainTestSize\" type=\"number\" value=\"0.2\" step=\"0.01\" min=\"0.1\" max=\"0.5\" placeholder=\"Test Size\" />
          <input id=\"trainSeed\" type=\"number\" value=\"42\" placeholder=\"Random Seed\" />
          <label class=\"muted\"><input id=\"trainSetProduction\" type=\"checkbox\" checked /> set as production</label>
          <button id=\"startTrainBtn\">Start Training Job</button>
        </div>
        <div class=\"hint\">Training runs in the background as an admin job and writes model artifacts to the configured model path.</div>
        <div style=\"margin-top:12px; max-height:310px; overflow:auto; border:1px solid var(--line); border-radius:10px;\">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Version</th>
                <th>Type</th>
                <th>Trained</th>
                <th>Metrics</th>
                <th>Production</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id=\"modelsBody\"></tbody>
          </table>
        </div>
      </div>

      <div class=\"card side\">
        <h2>Prediction Operations</h2>
        <div class=\"row\">
          <input id=\"backfillBatchSize\" type=\"number\" value=\"1000\" min=\"10\" max=\"10000\" />
          <button class=\"warn\" id=\"backfillBtn\">Backfill Predictions</button>
        </div>
        <div class=\"hint\">Backfill creates predictions for records without predictions for the current production model.</div>

        <h2 style=\"margin-top:18px;\">Quick Links</h2>
        <div class=\"row\">
          <a href=\"/docs\" target=\"_blank\"><button class=\"alt\" type=\"button\">API Docs</button></a>
          <a href=\"/api/v1/fields/overview\" target=\"_blank\"><button class=\"alt\" type=\"button\">Overview API</button></a>
          <a href=\"/health\" target=\"_blank\"><button class=\"alt\" type=\"button\">Health</button></a>
        </div>
      </div>

      <div class=\"card full\">
        <h2>GUI Field Builder</h2>
        <div class=\"row\">
          <span class=\"badge\">Dropdowns</span>
          <select id=\"uiDropdownForm\">
            <option value=\"manual_entry\">manual_entry</option>
            <option value=\"prediction\">prediction</option>
          </select>
          <input id=\"uiDropdownField\" placeholder=\"field key (e.g. crop_name_en)\" />
          <input id=\"uiDropdownValue\" placeholder=\"option value\" />
          <button id=\"uiAddDropdownBtn\">Add Option</button>
          <button class=\"alt\" id=\"uiRemoveDropdownBtn\">Remove Option</button>
        </div>

        <div class=\"row\" style=\"margin-top:8px;\">
          <span class=\"badge\">Custom Fields</span>
          <select id=\"uiCustomForm\">
            <option value=\"manual_entry\">manual_entry</option>
            <option value=\"prediction\">prediction</option>
          </select>
          <input id=\"uiCustomKey\" placeholder=\"field_key (e.g. soil_type)\" />
          <input id=\"uiCustomLabel\" placeholder=\"Label (e.g. Soil Type)\" />
          <select id=\"uiCustomType\">
            <option value=\"text\">text</option>
            <option value=\"number\">number</option>
            <option value=\"select\">select</option>
            <option value=\"boolean\">boolean</option>
          </select>
          <input id=\"uiCustomPayloadKey\" placeholder=\"payload_key (optional)\" />
          <input id=\"uiCustomOptions\" placeholder=\"options CSV (for select)\" />
          <label class=\"muted\"><input id=\"uiCustomRequired\" type=\"checkbox\" /> required</label>
          <button id=\"uiSaveCustomBtn\">Save Field</button>
          <button class=\"alt\" id=\"uiDeleteCustomBtn\">Delete Field</button>
        </div>

        <div class=\"hint\">Changes are persisted and picked up by frontend forms that consume dynamic config.</div>
        <pre class=\"jsonbox\" id=\"uiConfigView\">Loading UI config...</pre>
      </div>

      <div class=\"card full\">
        <h2>Admin Jobs</h2>
        <div style=\"max-height:260px; overflow:auto; border:1px solid var(--line); border-radius:10px;\">
          <table>
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Started</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody id=\"jobsBody\"></tbody>
          </table>
        </div>
      </div>

      <div class=\"card wide\">
        <h2>Data Ingestion Logs</h2>
        <div style=\"max-height:260px; overflow:auto; border:1px solid var(--line); border-radius:10px;\">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Source</th>
                <th>Status</th>
                <th>Parsed</th>
                <th>Inserted</th>
                <th>Updated</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody id=\"ingestionBody\"></tbody>
          </table>
        </div>
      </div>

      <div class=\"card side\">
        <h2>Activity Feed</h2>
        <div class=\"log\" id=\"activityLog\">Waiting for events...</div>
      </div>
    </div>
  </div>

  <script>
    const KEY_REQUIRED = __ADMIN_KEY_REQUIRED__;

    const state = {
      adminKey: localStorage.getItem("nutrition_admin_key") || "",
      polling: null,
    };

    const $ = (id) => document.getElementById(id);

    function log(message) {
      const el = $("activityLog");
      const ts = new Date().toISOString();
      el.textContent = `[${ts}] ${message}\n` + el.textContent;
    }

    function authHeaders() {
      const headers = { "Content-Type": "application/json" };
      if (state.adminKey) headers["X-Admin-Key"] = state.adminKey;
      return headers;
    }

    async function fetchJSON(url, options = {}) {
      const opts = { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } };
      const res = await fetch(url, opts);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${errText}`);
      }
      return res.json();
    }

    function badge(status) {
      return `<span class=\"status ${status}\">${status}</span>`;
    }

    async function loadSystem() {
      const data = await fetchJSON("/admin/api/system-status");
      $("kpiFieldSeasons").textContent = (data.overview.total_field_seasons || 0).toLocaleString();
      $("kpiPredictions").textContent = (data.overview.prediction_stats.total_predictions || 0).toLocaleString();
      $("kpiModels").textContent = (data.model_count || 0).toLocaleString();
      $("kpiProduction").textContent = data.production_model || "none";
    }

    async function loadModels() {
      const data = await fetchJSON("/admin/api/models");
      const rows = data.models.map((m) => {
        const metrics = m.performance_metrics || {};
        const valR2 = metrics.val_r2 ?? metrics.r2 ?? "-";
        const valRmse = metrics.val_rmse ?? metrics.rmse ?? "-";
        const prod = m.is_production ? '<span class=\"badge\">production</span>' : '';
        const action = m.is_production
          ? '<span class=\"muted\">active</span>'
          : `<button class=\"alt\" onclick=\"setProduction(${m.model_version_id})\">Set Production</button>`;
        return `<tr>
          <td>${m.model_version_id}</td>
          <td><strong>${m.version_tag}</strong></td>
          <td>${m.model_type}</td>
          <td>${m.training_date || '-'}</td>
          <td>R2: ${valR2}<br/>RMSE: ${valRmse}</td>
          <td>${prod}</td>
          <td>${action}</td>
        </tr>`;
      }).join("");
      $("modelsBody").innerHTML = rows || '<tr><td colspan=\"7\" class=\"muted\">No models yet</td></tr>';
    }

    async function loadJobs() {
      const data = await fetchJSON("/admin/api/jobs");
      const rows = data.jobs.map((j) => {
        const progress = j.total > 0 ? `${j.processed}/${j.total}` : (j.message || "-");
        return `<tr>
          <td><code>${j.job_id}</code></td>
          <td>${j.job_type}</td>
          <td>${badge(j.status)}</td>
          <td>${progress}</td>
          <td>${j.started_at || '-'}</td>
          <td>${j.completed_at || '-'}</td>
        </tr>`;
      }).join("");
      $("jobsBody").innerHTML = rows || '<tr><td colspan=\"6\" class=\"muted\">No admin jobs yet</td></tr>';
    }

    async function loadIngestionLogs() {
      const data = await fetchJSON("/admin/api/ingestion-logs?limit=25");
      const rows = data.logs.map((l) => `
        <tr>
          <td>${l.ingestion_id}</td>
          <td>${l.source_filename}</td>
          <td>${badge(l.status)}</td>
          <td>${l.records_parsed ?? 0}</td>
          <td>${l.records_inserted ?? 0}</td>
          <td>${l.records_updated ?? 0}</td>
          <td>${l.ingestion_completed_at || '-'}</td>
        </tr>
      `).join("");
      $("ingestionBody").innerHTML = rows || '<tr><td colspan=\"7\" class=\"muted\">No ingestion records</td></tr>';
    }

    async function loadUiConfig() {
      const data = await fetchJSON("/admin/api/ui-config");
      $("uiConfigView").textContent = JSON.stringify(data.config, null, 2);
    }

    async function refreshAll() {
      try {
        await Promise.all([loadSystem(), loadModels(), loadJobs(), loadIngestionLogs(), loadUiConfig()]);
        log("Dashboard refreshed");
      } catch (e) {
        log(`Refresh failed: ${e.message}`);
      }
    }

    async function startTraining() {
      const payload = {
        model_type: $("trainModelType").value,
        start_season: Number($("trainStartSeason").value),
        end_season: Number($("trainEndSeason").value),
        test_size: Number($("trainTestSize").value),
        random_seed: Number($("trainSeed").value),
        set_production: $("trainSetProduction").checked,
      };
      try {
        const result = await fetchJSON("/admin/api/models/train", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        log(`Training job queued: ${result.job_id}`);
        refreshAll();
      } catch (e) {
        log(`Training request failed: ${e.message}`);
      }
    }

    async function setProduction(versionId) {
      try {
        await fetchJSON("/admin/api/models/set-production", {
          method: "POST",
          body: JSON.stringify({ version_id: versionId }),
        });
        log(`Model ${versionId} set as production`);
        refreshAll();
      } catch (e) {
        log(`Set production failed: ${e.message}`);
      }
    }

    async function startBackfill() {
      const payload = { batch_size: Number($("backfillBatchSize").value) };
      try {
        const result = await fetchJSON("/admin/api/predictions/backfill", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        log(`Backfill job queued: ${result.job_id}`);
        refreshAll();
      } catch (e) {
        log(`Backfill request failed: ${e.message}`);
      }
    }

    async function addDropdownOption() {
      const payload = {
        form_key: $("uiDropdownForm").value,
        field_key: $("uiDropdownField").value.trim(),
        option: $("uiDropdownValue").value.trim(),
      };
      try {
        await fetchJSON("/admin/api/ui-config/dropdown-option/add", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        log(`Added option '${payload.option}' to ${payload.form_key}.${payload.field_key}`);
        $("uiDropdownValue").value = "";
        refreshAll();
      } catch (e) {
        log(`Add dropdown option failed: ${e.message}`);
      }
    }

    async function removeDropdownOption() {
      const payload = {
        form_key: $("uiDropdownForm").value,
        field_key: $("uiDropdownField").value.trim(),
        option: $("uiDropdownValue").value.trim(),
      };
      try {
        await fetchJSON("/admin/api/ui-config/dropdown-option/remove", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        log(`Removed option '${payload.option}' from ${payload.form_key}.${payload.field_key}`);
        $("uiDropdownValue").value = "";
        refreshAll();
      } catch (e) {
        log(`Remove dropdown option failed: ${e.message}`);
      }
    }

    async function saveCustomField() {
      const payload = {
        form_key: $("uiCustomForm").value,
        field_key: $("uiCustomKey").value.trim(),
        label: $("uiCustomLabel").value.trim(),
        type: $("uiCustomType").value,
        payload_key: $("uiCustomPayloadKey").value.trim() || null,
        required: $("uiCustomRequired").checked,
        options: $("uiCustomOptions").value
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x.length > 0),
      };
      try {
        await fetchJSON("/admin/api/ui-config/custom-field/upsert", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        log(`Saved custom field ${payload.form_key}.${payload.field_key}`);
        refreshAll();
      } catch (e) {
        log(`Save custom field failed: ${e.message}`);
      }
    }

    async function deleteCustomField() {
      const payload = {
        form_key: $("uiCustomForm").value,
        field_key: $("uiCustomKey").value.trim(),
      };
      try {
        await fetchJSON("/admin/api/ui-config/custom-field/delete", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        log(`Deleted custom field ${payload.form_key}.${payload.field_key}`);
        refreshAll();
      } catch (e) {
        log(`Delete custom field failed: ${e.message}`);
      }
    }

    function saveKey() {
      state.adminKey = $("adminKey").value.trim();
      localStorage.setItem("nutrition_admin_key", state.adminKey);
      log("Admin key saved in browser localStorage");
    }

    function setup() {
      $("adminKey").value = state.adminKey;
      $("saveKeyBtn").addEventListener("click", saveKey);
      $("refreshBtn").addEventListener("click", refreshAll);
      $("startTrainBtn").addEventListener("click", startTraining);
      $("backfillBtn").addEventListener("click", startBackfill);
      $("uiAddDropdownBtn").addEventListener("click", addDropdownOption);
      $("uiRemoveDropdownBtn").addEventListener("click", removeDropdownOption);
      $("uiSaveCustomBtn").addEventListener("click", saveCustomField);
      $("uiDeleteCustomBtn").addEventListener("click", deleteCustomField);

      $("authMode").textContent = KEY_REQUIRED
        ? "Admin key required"
        : "Admin key optional (not configured server-side)";

      refreshAll();
      state.polling = setInterval(refreshAll, 12000);
    }

    window.setProduction = setProduction;
    setup();
  </script>
</body>
</html>
"""


def _require_admin_key(x_admin_key: Optional[str] = Header(default=None, alias="X-Admin-Key")) -> None:
    expected = settings.admin_api_key
    if not expected:
        return
    if x_admin_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Admin-Key",
        )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _create_job(job_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    job_id = uuid4().hex[:12]
    job = {
        "job_id": job_id,
        "job_type": job_type,
        "status": "queued",
        "payload": payload,
        "message": "queued",
        "processed": 0,
        "total": 0,
        "result": None,
        "error": None,
        "started_at": None,
        "completed_at": None,
        "created_at": _utc_now(),
    }
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    return job


def _update_job(job_id: str, **updates: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job.update(updates)


def _serialize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "job_id": job["job_id"],
        "job_type": job["job_type"],
        "status": job["status"],
        "message": job.get("message"),
        "processed": job.get("processed", 0),
        "total": job.get("total", 0),
        "result": job.get("result"),
        "error": job.get("error"),
        "created_at": _as_iso(job.get("created_at")),
        "started_at": _as_iso(job.get("started_at")),
        "completed_at": _as_iso(job.get("completed_at")),
    }


def _run_training_job(job_id: str, payload: Dict[str, Any]) -> None:
    db: Session = SessionLocal()
    try:
        _update_job(job_id, status="running", started_at=_utc_now(), message="preparing data")
        trainer = ModelTrainer(db)
        result = trainer.train(
            model_type=payload["model_type"],
            start_season=payload["start_season"],
            end_season=payload["end_season"],
            test_size=payload["test_size"],
            random_state=payload["random_seed"],
        )

        set_production = payload.get("set_production", True)
        production_switched = False
        if set_production:
            mv = (
                db.query(models.ModelVersion)
                .filter(models.ModelVersion.version_tag == result["version_tag"])
                .first()
            )
            if mv:
                crud.set_production_model(db, mv.model_version_id)
                production_switched = True

        _update_job(
            job_id,
            status="completed",
            completed_at=_utc_now(),
            message="completed",
            result={
                **result,
                "set_production": production_switched,
            },
        )
    except Exception as exc:
        db.rollback()
        _update_job(
            job_id,
            status="failed",
            completed_at=_utc_now(),
            message="failed",
            error=str(exc),
        )
    finally:
        db.close()


def _run_backfill_job(job_id: str, payload: Dict[str, Any]) -> None:
    db: Session = SessionLocal()
    try:
        _update_job(job_id, status="running", started_at=_utc_now(), message="resolving production model")
        predictor = PredictionService(db)
        model_version = predictor.get_production_model()
        if not model_version:
            raise ValueError("No production model available. Train and deploy a model first.")

        subq = (
            db.query(models.ModelPrediction.field_season_id)
            .filter(models.ModelPrediction.model_version_id == model_version.model_version_id)
            .subquery()
        )

        query = (
            db.query(
                models.FieldSeason.field_season_id,
                models.Field.acres,
                models.Field.lat,
                models.Field.long,
                models.Field.county,
                models.Field.state,
                models.Crop.crop_name_en,
                models.Variety.variety_name_en,
                models.Season.season_year,
                models.FieldSeason.totalN_per_ac,
                models.FieldSeason.totalP_per_ac,
                models.FieldSeason.totalK_per_ac,
            )
            .join(models.Field, models.FieldSeason.field_id == models.Field.field_id)
            .join(models.Crop, models.FieldSeason.crop_id == models.Crop.crop_id)
            .outerjoin(models.Variety, models.FieldSeason.variety_id == models.Variety.variety_id)
            .join(models.Season, models.FieldSeason.season_id == models.Season.season_id)
            .outerjoin(subq, models.FieldSeason.field_season_id == subq.c.field_season_id)
            .filter(subq.c.field_season_id.is_(None))
        )

        total = query.count()
        _update_job(job_id, total=total, message=f"found {total} records")

        if total == 0:
            _update_job(
                job_id,
                status="completed",
                completed_at=_utc_now(),
                message="no records need backfill",
                result={"processed": 0, "failed": 0, "model_version": model_version.version_tag},
            )
            return

        batch_size = payload["batch_size"]
        processed = 0
        failed = 0
        last_field_season_id = -1

        while True:
            rows = (
                query
                .filter(models.FieldSeason.field_season_id > last_field_season_id)
                .order_by(models.FieldSeason.field_season_id.asc())
                .limit(batch_size)
                .all()
            )
            if not rows:
                break

            for row in rows:
                try:
                    input_data = {
                        "acres": float(row.acres) if row.acres is not None else 0.0,
                        "lat": float(row.lat) if row.lat is not None else 0.0,
                        "long": float(row.long) if row.long is not None else 0.0,
                        "county": row.county,
                        "state": row.state,
                        "crop": row.crop_name_en,
                        "variety": row.variety_name_en,
                        "season": row.season_year,
                        "totalN_per_ac": float(row.totalN_per_ac) if row.totalN_per_ac is not None else 0.0,
                        "totalP_per_ac": float(row.totalP_per_ac) if row.totalP_per_ac is not None else 0.0,
                        "totalK_per_ac": float(row.totalK_per_ac) if row.totalK_per_ac is not None else 0.0,
                    }
                    prediction = predictor.predict(input_data, model_version=model_version)

                    with db.begin_nested():
                        db.add(
                            models.ModelPrediction(
                                field_season_id=row.field_season_id,
                                model_version_id=model_version.model_version_id,
                                predicted_yield=prediction["predicted_yield"],
                                confidence_lower=prediction["confidence_lower"],
                                confidence_upper=prediction["confidence_upper"],
                            )
                        )
                        db.flush()
                    processed += 1
                except IntegrityError:
                    failed += 1
                except Exception:
                    failed += 1

            db.commit()
            last_field_season_id = rows[-1].field_season_id
            _update_job(
                job_id,
                processed=processed + failed,
                message=f"processed {processed + failed} / {total}",
            )

        _update_job(
            job_id,
            status="completed",
            completed_at=_utc_now(),
            message="completed",
            result={
                "processed": processed,
                "failed": failed,
                "total": total,
                "model_version": model_version.version_tag,
            },
        )
    except Exception as exc:
        db.rollback()
        _update_job(
            job_id,
            status="failed",
            completed_at=_utc_now(),
            message="failed",
            error=str(exc),
        )
    finally:
        db.close()


@router.get("", response_class=HTMLResponse)
async def admin_panel() -> HTMLResponse:
    html = ADMIN_HTML.replace("__ADMIN_KEY_REQUIRED__", "true" if bool(settings.admin_api_key) else "false")
    return HTMLResponse(content=html)


@router.get("/api/system-status")
async def admin_system_status(
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    try:
        db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as exc:
        db_status = f"unhealthy: {exc}"

    overview = crud.get_overview_stats(db)
    model_count = db.query(func.count(models.ModelVersion.model_version_id)).scalar() or 0
    production = crud.get_production_model_version(db)

    return {
        "database": db_status,
        "environment": settings.environment,
        "debug": settings.debug,
        "model_count": model_count,
        "production_model": production.version_tag if production else None,
        "overview": overview,
        "admin_key_required": bool(settings.admin_api_key),
    }


@router.get("/api/models")
async def admin_models(
    limit: int = 50,
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    models_list = crud.get_model_versions(db, limit=limit)
    return {
        "models": [
            {
                "model_version_id": m.model_version_id,
                "version_tag": m.version_tag,
                "model_type": m.model_type,
                "is_production": bool(m.is_production),
                "training_date": _as_iso(m.training_date),
                "performance_metrics": m.performance_metrics,
                "training_data_range": m.training_data_range,
            }
            for m in models_list
        ]
    }


@router.post("/api/models/train")
async def admin_train_model(
    request: TrainJobRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    if request.end_season < request.start_season:
        raise HTTPException(status_code=400, detail="end_season must be >= start_season")

    job = _create_job("train_model", request.model_dump())
    background_tasks.add_task(_run_training_job, job["job_id"], request.model_dump())
    return {"status": "queued", "job_id": job["job_id"]}


@router.post("/api/models/set-production")
async def admin_set_production(
    request: SetProductionRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    mv = crud.set_production_model(db, request.version_id)
    if not mv:
        raise HTTPException(status_code=404, detail=f"Model version {request.version_id} not found")
    return {
        "status": "success",
        "model_version_id": mv.model_version_id,
        "version_tag": mv.version_tag,
    }


@router.post("/api/predictions/backfill")
async def admin_backfill_predictions(
    request: BackfillJobRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    job = _create_job("backfill_predictions", request.model_dump())
    background_tasks.add_task(_run_backfill_job, job["job_id"], request.model_dump())
    return {"status": "queued", "job_id": job["job_id"]}


@router.get("/api/ingestion-logs")
async def admin_ingestion_logs(
    limit: int = 20,
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    logs = (
        db.query(models.DataIngestionLog)
        .order_by(models.DataIngestionLog.ingestion_started_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "logs": [
            {
                "ingestion_id": log.ingestion_id,
                "source_filename": log.source_filename,
                "status": log.status,
                "records_parsed": log.records_parsed,
                "records_inserted": log.records_inserted,
                "records_updated": log.records_updated,
                "records_skipped": log.records_skipped,
                "ingestion_started_at": _as_iso(log.ingestion_started_at),
                "ingestion_completed_at": _as_iso(log.ingestion_completed_at),
            }
            for log in logs
        ]
    }


@router.get("/api/ui-config")
async def admin_ui_config(
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    return {"config": load_ui_config()}


@router.get("/api/ui-config/public")
async def admin_ui_config_public(
    form_key: Optional[str] = None,
) -> Dict[str, Any]:
    config = load_ui_config()
    if form_key:
        return {"form_key": form_key, "config": get_form_config(form_key)}
    return {"config": config}


@router.post("/api/ui-config/dropdown-option/add")
async def admin_add_dropdown_option(
    request: UiDropdownOptionRequest,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    config = add_dropdown_option(request.form_key, request.field_key, request.option)
    return {"status": "success", "config": config}


@router.post("/api/ui-config/dropdown-option/remove")
async def admin_remove_dropdown_option(
    request: UiDropdownOptionRequest,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    config = remove_dropdown_option(request.form_key, request.field_key, request.option)
    return {"status": "success", "config": config}


@router.post("/api/ui-config/custom-field/upsert")
async def admin_upsert_custom_field(
    request: UiCustomFieldRequest,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    config = upsert_custom_field(request.form_key, request.model_dump())
    return {"status": "success", "config": config}


@router.post("/api/ui-config/custom-field/delete")
async def admin_delete_custom_field(
    request: UiCustomFieldDeleteRequest,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    config = delete_custom_field(request.form_key, request.field_key)
    return {"status": "success", "config": config}


@router.get("/api/jobs")
async def admin_jobs(
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    with _JOBS_LOCK:
        jobs = sorted(_JOBS.values(), key=lambda j: j["created_at"], reverse=True)
    return {"jobs": [_serialize_job(job) for job in jobs]}


@router.get("/api/jobs/{job_id}")
async def admin_job_detail(
    job_id: str,
    _: None = Depends(_require_admin_key),
) -> Dict[str, Any]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize_job(job)

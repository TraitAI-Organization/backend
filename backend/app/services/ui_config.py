"""
Persistent UI configuration service used by admin panel and frontend forms.
"""
from __future__ import annotations

import copy
import json
import os
from threading import Lock
from typing import Any, Dict, List, Optional

from app.config import settings

_UI_LOCK = Lock()


def _default_ui_config() -> Dict[str, Any]:
    return {
        "manual_entry": {
            "dropdowns": {
                "crop_name_en": ["Wheat, Hard Winter", "Corn", "Sorghum", "Fallow", "Other"],
                "state": ["Kansas", "Nebraska", "Oklahoma", "Texas", "Colorado", "Other"],
                "type": [
                    "Manual Entry",
                    "Planting/Seeding",
                    "Fertilizing",
                    "Spraying",
                    "Irrigation",
                    "Harvesting",
                    "Other",
                ],
                "status": ["Completed", "In Progress", "Failed", "Cancelled"],
                "irrigation_method": ["None", "Center Pivot", "Drip", "Flood", "Sprinkler", "Other"],
            },
            "custom_fields": [],
        },
        "prediction": {
            "dropdowns": {
                "crop": [],
                "state": [],
            },
            "custom_fields": [],
        },
    }


def _ensure_path(path: str) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def _deep_merge(defaults: Dict[str, Any], saved: Dict[str, Any]) -> Dict[str, Any]:
    merged = copy.deepcopy(defaults)
    for key, value in (saved or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _normalize_custom_field(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    field_key = str(item.get("field_key", "")).strip()
    label = str(item.get("label", "")).strip()
    field_type = str(item.get("type", "text")).strip().lower()

    if not field_key or not label:
        return None
    if field_type not in {"text", "number", "select", "boolean"}:
        field_type = "text"

    options = item.get("options") or []
    if not isinstance(options, list):
        options = []

    normalized = {
        "field_key": field_key,
        "label": label,
        "type": field_type,
        "required": bool(item.get("required", False)),
        "payload_key": str(item.get("payload_key") or field_key),
        "help_text": str(item.get("help_text", "")) if item.get("help_text") is not None else "",
        "default": item.get("default"),
        "options": [str(x).strip() for x in options if str(x).strip()],
    }
    return normalized


def load_ui_config() -> Dict[str, Any]:
    path = settings.ui_config_path
    defaults = _default_ui_config()

    with _UI_LOCK:
        _ensure_path(path)
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(defaults, fh, indent=2)
            return defaults

        try:
            with open(path, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
            merged = _deep_merge(defaults, saved)
            return merged
        except Exception:
            # Recover gracefully with defaults if file is corrupted.
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(defaults, fh, indent=2)
            return defaults


def save_ui_config(config: Dict[str, Any]) -> Dict[str, Any]:
    path = settings.ui_config_path
    with _UI_LOCK:
        _ensure_path(path)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(config, fh, indent=2)
    return config


def get_form_config(form_key: str) -> Dict[str, Any]:
    config = load_ui_config()
    form = config.get(form_key) or {}
    return {
        "dropdowns": form.get("dropdowns", {}),
        "custom_fields": form.get("custom_fields", []),
    }


def add_dropdown_option(form_key: str, field_key: str, option: str) -> Dict[str, Any]:
    option = option.strip()
    if not option:
        raise ValueError("option cannot be empty")

    config = load_ui_config()
    form = config.setdefault(form_key, {"dropdowns": {}, "custom_fields": []})
    dropdowns = form.setdefault("dropdowns", {})
    options = dropdowns.setdefault(field_key, [])

    if option not in options:
        options.append(option)
    dropdowns[field_key] = options

    return save_ui_config(config)


def remove_dropdown_option(form_key: str, field_key: str, option: str) -> Dict[str, Any]:
    config = load_ui_config()
    form = config.setdefault(form_key, {"dropdowns": {}, "custom_fields": []})
    dropdowns = form.setdefault("dropdowns", {})
    options = dropdowns.get(field_key, [])
    dropdowns[field_key] = [x for x in options if x != option]
    return save_ui_config(config)


def upsert_custom_field(form_key: str, field: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_custom_field(field)
    if not normalized:
        raise ValueError("custom field must include valid field_key and label")

    config = load_ui_config()
    form = config.setdefault(form_key, {"dropdowns": {}, "custom_fields": []})
    custom_fields: List[Dict[str, Any]] = form.setdefault("custom_fields", [])

    replaced = False
    for idx, existing in enumerate(custom_fields):
        if existing.get("field_key") == normalized["field_key"]:
            custom_fields[idx] = normalized
            replaced = True
            break
    if not replaced:
        custom_fields.append(normalized)

    form["custom_fields"] = custom_fields
    return save_ui_config(config)


def delete_custom_field(form_key: str, field_key: str) -> Dict[str, Any]:
    config = load_ui_config()
    form = config.setdefault(form_key, {"dropdowns": {}, "custom_fields": []})
    custom_fields = form.setdefault("custom_fields", [])
    form["custom_fields"] = [x for x in custom_fields if x.get("field_key") != field_key]
    return save_ui_config(config)


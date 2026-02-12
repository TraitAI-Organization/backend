"""
Aggregate all routers for API v1

This module simply re-exports all individual routers from the endpoints package.
The main app will include each router with appropriate prefixes.
"""
from .endpoints import (
    fields_router,
    predictions_router,
    models_router,
    exports_router,
    data_upload_router,
    manual_entry_router,
)

__all__ = [
    "fields_router",
    "predictions_router",
    "models_router",
    "exports_router",
    "data_upload_router",
    "manual_entry_router",
]
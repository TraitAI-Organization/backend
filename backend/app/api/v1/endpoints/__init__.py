"""
Endpoints package - exports all routers for inclusion in main app.
"""
from .fields import router as fields_router
from .predictions import router as predictions_router
from .models import router as models_router
from .exports import router as exports_router
from .data_upload import router as data_upload_router
from .manual_entry import router as manual_entry_router

__all__ = [
    "fields_router",
    "predictions_router",
    "models_router",
    "exports_router",
    "data_upload_router",
    "manual_entry_router",
]
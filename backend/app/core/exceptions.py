"""
Custom exceptions for the application
"""
from typing import Optional, Dict, Any


class NutritionAIError(Exception):
    """Base exception for Nutrition AI errors."""
    def __init__(self, message: str, status_code: int = 500, details: Optional[Dict[str, Any]] = None):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class ValidationError(NutritionAIError):
    """Raised when input validation fails."""
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=422, details=details)


class NotFoundError(NutritionAIError):
    """Raised when a requested resource is not found."""
    def __init__(self, message: str, resource: Optional[str] = None):
        details = {"resource": resource} if resource else {}
        super().__init__(message, status_code=404, details=details)


class ConflictError(NutritionAIError):
    """Raised when a conflict occurs (e.g., duplicate entry)."""
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=409, details=details)


class ModelError(NutritionAIError):
    """Raised when ML model fails to load or predict."""
    def __init__(self, message: str, model_version: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        details = details or {}
        if model_version:
            details["model_version"] = model_version
        super().__init__(message, status_code=500, details=details)


class DataIngestionError(NutritionAIError):
    """Raised when data ingestion fails."""
    def __init__(self, message: str, filename: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        details = details or {}
        if filename:
            details["filename"] = filename
        super().__init__(message, status_code=400, details=details)
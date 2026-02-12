"""
Nutrition AI Backend - FastAPI Application
"""
from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time
import logging

from app.config import settings
from app.database.session import engine, Base
from app.database import models  # Ensure models are imported
from app.api.v1.routers import (
    fields_router,
    predictions_router,
    models_router,
    exports_router,
    data_upload_router,
    manual_entry_router,
)
from app.core.exceptions import NutritionAIError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create tables (in production use Alembic migrations)
# Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Nutrition AI API",
    description="Agricultural yield prediction platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handlers
@app.exception_handler(NutritionAIError)
async def nutrition_ai_exception_handler(request: Request, exc: NutritionAIError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.message, "details": exc.details},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.detail, "details": getattr(exc, "details", {})},
    )


# Request timing middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(round(process_time * 1000, 2))
    return response


# Health check
@app.get("/health", tags=["health"])
async def health_check():
    """Basic health check endpoint."""
    try:
        # Test database connection
        from app.database.session import SessionLocal
        db = SessionLocal()
        db.execute("SELECT 1")
        db.close()
        db_status = "healthy"
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        db_status = "unhealthy"

    return {
        "status": "ok" if db_status == "healthy" else "degraded",
        "database": db_status,
        "timestamp": time.time(),
        "version": app.version,
        "environment": settings.environment,
    }


# Root endpoint
@app.get("/", tags=["root"])
async def root():
    """Root endpoint with API info."""
    return {
        "name": "Nutrition AI API",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
    }


# Include routers
app.include_router(fields_router, prefix="/api/v1/fields", tags=["fields"])
app.include_router(predictions_router, prefix="/api/v1/predict", tags=["predictions"])
app.include_router(models_router, prefix="/api/v1/models", tags=["models"])
app.include_router(exports_router, prefix="/api/v1/export", tags=["exports"])
app.include_router(data_upload_router, prefix="/api/v1/data", tags=["data-upload"])
app.include_router(manual_entry_router, prefix="/api/v1/manual-entry", tags=["manual-entry"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
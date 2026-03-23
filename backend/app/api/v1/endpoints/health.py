"""
Health check endpoint
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database.session import get_db

router = APIRouter()


@router.get("", summary="Health check")
async def health_check(db: Session = Depends(get_db)):
    """
    Check API and database health.
    """
    try:
        # Test database connection
        db.execute("SELECT 1")
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    return {
        "status": "ok" if db_status == "healthy" else "degraded",
        "database": db_status,
        "timestamp": "now",  # TODO: use datetime.utcnow()
    }
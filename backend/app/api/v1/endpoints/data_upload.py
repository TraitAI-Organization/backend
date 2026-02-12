"""
Data Upload endpoints - CSV file ingestion
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import desc
import tempfile
import os
from typing import Optional

from app.database.session import get_db
from app.services.data_ingestion import DataIngestionService
from app.database import models
from app.database.models import DataIngestionLog

router = APIRouter()


@router.post("/upload", summary="Upload CSV file for data ingestion")
async def upload_csv(
    file: UploadFile = File(..., description="CSV file to import"),
    source_filename: Optional[str] = Form(None, description="Optional source filename for tracking"),
    db: Session = Depends(get_db)
):
    """
    Upload a CSV file to ingest agricultural data into the database.

    The CSV should match the expected schema (see documentation).
    The file will be processed asynchronously and ingested.

    Returns:
        ingestion_id, status, and statistics
    """
    # Validate file type
    if not file.filename.endswith('.csv'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV files are allowed"
        )

    # Save uploaded file to temporary location
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.csv') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save uploaded file: {str(e)}"
        )

    try:
        # Process the file
        service = DataIngestionService(db)
        result = service.ingest_csv(
            csv_path=tmp_path,
            source_filename=source_filename or file.filename
        )

        # Clean up temp file
        os.unlink(tmp_path)

        return result

    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to ingest CSV: {str(e)}"
        )


@router.get("/ingestion/logs", summary="List data ingestion logs")
async def get_ingestion_logs(
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """
    Get recent data ingestion logs (for monitoring uploads).
    """
    logs = db.query(DataIngestionLog)\
        .order_by(desc(DataIngestionLog.ingestion_started_at))\
        .limit(limit)\
        .all()

    return [
        {
            "ingestion_id": log.ingestion_id,
            "source_filename": log.source_filename,
            "status": log.status,
            "records_parsed": log.records_parsed,
            "records_inserted": log.records_inserted,
            "records_updated": log.records_updated,
            "records_skipped": log.records_skipped,
            "error_details": log.error_details,
            "ingestion_started_at": log.ingestion_started_at,
            "ingestion_completed_at": log.ingestion_completed_at,
        }
        for log in logs
    ]

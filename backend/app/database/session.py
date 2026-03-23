"""
Database session management
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from typing import Generator
import os

from app.config import settings

# Create engine
engine = create_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    echo=settings.debug,  # Log SQL in debug mode
)

# SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base for declarative models
Base = declarative_base()


def get_db() -> Generator:
    """
    Dependency for FastAPI to get database session.
    Ensures session is closed after request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
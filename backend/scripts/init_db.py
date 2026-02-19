#!/usr/bin/env python
"""
Initialize database - create tables
"""
import sys
from app.database.session import Base, engine
from app.database import models  # noqa: F401 - ensure ORM models are registered
from app.config import settings

def init_database():
    """Create all database tables."""
    print("Initializing database...")
    print(f"Database URL: {settings.database_url}")

    try:
        Base.metadata.create_all(bind=engine)
        print("✓ Database tables created successfully.")
        return True
    except Exception as e:
        print(f"✗ Failed to create tables: {e}")
        return False

if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)

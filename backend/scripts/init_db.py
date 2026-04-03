#!/usr/bin/env python
"""
Initialize database - create tables
"""
import sys
from pathlib import Path
from sqlalchemy import inspect

# Ensure backend root is importable when run as `python scripts/init_db.py`.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database.session import Base, engine
from app.database import models  # noqa: F401 - ensure ORM models are registered
from app.config import settings

def init_database():
    """Create all database tables."""
    print("Initializing database...")
    print(f"Database URL: {settings.database_url}")

    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        expected_tables = set(Base.metadata.tables.keys())

        if expected_tables.issubset(existing_tables):
            print("✓ Database tables already exist. Skipping creation.")
            return True

        Base.metadata.create_all(bind=engine)
        print("✓ Database tables created successfully.")
        return True
    except Exception as e:
        print(f"✗ Failed to create tables: {e}")
        return False

if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)

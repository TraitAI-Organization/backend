#!/usr/bin/env python
"""
Import CSV data into the database.
Usage: python import_data.py --csv <path_to_csv> [--source-filename <name>]
"""
import argparse
import sys
import os
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.services.data_ingestion import DataIngestionService

def main():
    parser = argparse.ArgumentParser(description="Import agricultural data CSV into PostgreSQL")
    parser.add_argument('--csv', required=True, help='Path to CSV file')
    parser.add_argument('--source-filename', help='Source filename for tracking (defaults to CSV basename)')
    parser.add_argument('--chunk-size', type=int, default=10000, help='Process N rows at a time')

    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"Error: CSV file not found: {args.csv}")
        return 1

    print(f"Importing {args.csv}...")
    db: Session = SessionLocal()
    try:
        service = DataIngestionService(db)
        result = service.ingest_csv(
            csv_path=args.csv,
            source_filename=args.source_filename,
            chunk_size=args.chunk_size
        )
        print(f"\nImport complete:")
        print(f"  Status: {result['status']}")
        print(f"  Rows parsed: {result.get('records_parsed', 0):,}")
        print(f"  Rows inserted: {result.get('records_inserted', 0):,}")
        print(f"  Rows updated: {result.get('records_updated', 0):,}")
        print(f"  Rows skipped: {result.get('records_skipped', 0):,}")
        return 0
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        db.close()

if __name__ == "__main__":
    sys.exit(main())
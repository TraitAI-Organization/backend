"""
Data ingestion service - CSV import and processing
"""
import os
import pandas as pd
import hashlib
from typing import Dict, Any, List, Tuple
from sqlalchemy.orm import Session
import logging
from datetime import datetime

from app.database import crud, models
from app.database.crud import get_field_by_number, get_crop_by_name, get_variety_by_name_and_crop, get_season_by_year, create_field, create_crop, create_variety, create_season, get_ingestion_by_hash, create_ingestion_log, update_ingestion_log

logger = logging.getLogger(__name__)


class DataIngestionService:
    """
    Service for ingesting CSV data into the database.
    """
    def __init__(self, db: Session):
        self.db = db

    def compute_file_hash(self, filepath: str) -> str:
        """Compute SHA256 hash of a file."""
        sha256_hash = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    def parse_date(self, date_str: str) -> datetime:
        """Parse date string from CSV."""
        if pd.isna(date_str):
            return None
        try:
            return pd.to_datetime(date_str)
        except:
            return None

    def ingest_csv(
        self,
        csv_path: str,
        source_filename: str = None,
        chunk_size: int = 10000
    ) -> Dict[str, Any]:
        """
        Ingest a CSV file into the database.
        """
        source_filename = source_filename or os.path.basename(csv_path)
        file_hash = self.compute_file_hash(csv_path)

        # Check if already ingested
        existing = get_ingestion_by_hash(self.db, file_hash)
        if existing:
            logger.info(f"File {source_filename} already ingested (ingestion_id={existing.ingestion_id})")
            return {
                'status': 'skipped',
                'message': 'File already ingested',
                'ingestion_id': existing.ingestion_id,
            }

        # Create ingestion log
        ingestion_log = create_ingestion_log(self.db, type('obj', (object,), {
            'source_filename': source_filename,
            'file_hash': file_hash,
            'status': 'processing',
        })())

        try:
            records_parsed = 0
            records_inserted = 0
            records_updated = 0
            records_skipped = 0

            # Read CSV in chunks
            for chunk in pd.read_csv(csv_path, chunksize=chunk_size, low_memory=False):
                # Clean column names
                chunk.columns = chunk.columns.str.strip()

                # Process each row
                for _, row in chunk.iterrows():
                    records_parsed += 1
                    try:
                        inserted = self._process_row(row, records_parsed)
                        if inserted == 'inserted':
                            records_inserted += 1
                        elif inserted == 'updated':
                            records_updated += 1
                        else:
                            records_skipped += 1
                    except Exception as e:
                        logger.error(f"Error processing row {records_parsed}: {e}")
                        records_skipped += 1
                        continue

                # Log progress
                if records_parsed % 10000 == 0:
                    logger.info(f"Processed {records_parsed} rows...")

                # Commit periodically
                self.db.commit()

            # Update ingestion log
            update_ingestion_log(
                self.db,
                ingestion_id=ingestion_log.ingestion_id,
                records_parsed=records_parsed,
                records_inserted=records_inserted,
                records_updated=records_updated,
                records_skipped=records_skipped,
                status='completed',
                ingestion_completed_at=datetime.utcnow(),
            )

            self.db.commit()

            logger.info(
                f"Ingestion complete: {records_parsed} parsed, "
                f"{records_inserted} inserted, {records_updated} updated, "
                f"{records_skipped} skipped"
            )

            return {
                'status': 'completed',
                'ingestion_id': ingestion_log.ingestion_id,
                'records_parsed': records_parsed,
                'records_inserted': records_inserted,
                'records_updated': records_updated,
                'records_skipped': records_skipped,
            }

        except Exception as e:
            logger.error(f"Ingestion failed: {e}", exc_info=True)
            update_ingestion_log(
                self.db,
                ingestion_id=ingestion_log.ingestion_id,
                status='failed',
                error_details={'error': str(e)},
            )
            self.db.rollback()
            raise

    def _process_row(self, row: pd.Series, row_num: int) -> str:
        """
        Process a single row from the CSV.
        """
        # Extract key fields
        field_number = int(row.get('field', 0))
        if field_number == 0:
            return 'skipped'

        crop_name = str(row.get('crop_name_en', '')).strip()
        if not crop_name or crop_name == 'nan':
            return 'skipped'

        variety_name = str(row.get('variety_name_en', '')).strip()
        if variety_name == 'nan':
            variety_name = None

        season_year = int(row.get('season', 0))
        if season_year == 0:
            return 'skipped'

        # Get or create crop
        crop = get_crop_by_name(self.db, crop_name)
        if not crop:
            crop = create_crop(self.db, type('obj', (object,), {
                'crop_name_en': crop_name,
                'is_active': True,
            })())

        # Get or create season
        season = get_season_by_year(self.db, season_year)
        if not season:
            season = create_season(self.db, type('obj', (object,), {
                'season_year': season_year,
                'is_current': False,
            })())

        # Get or create variety (linked to crop)
        if variety_name:
            variety = get_variety_by_name_and_crop(self.db, variety_name, crop.crop_id)
            if not variety:
                variety = create_variety(self.db, type('obj', (object,), {
                    'variety_name_en': variety_name,
                    'crop_id': crop.crop_id,
                    'is_active': True,
                })())
        else:
            variety = None

        # Get or create field
        field = get_field_by_number(self.db, field_number)
        acres = row.get('acres')
        lat = row.get('lat')
        long = row.get('long')
        county = str(row.get('county', '')) if pd.notna(row.get('county')) else None
        state = str(row.get('state', '')) if pd.notna(row.get('state')) else None

        if not field:
            field = create_field(self.db, type('obj', (object,), {
                'field_number': field_number,
                'acres': float(acres) if pd.notna(acres) else None,
                'lat': float(lat) if pd.notna(lat) else None,
                'long': float(long) if pd.notna(long) else None,
                'county': county,
                'state': state,
                'grower_id': None,
            })())
        else:
            # Update field info if missing
            updated = False
            if acres and field.acres is None:
                field.acres = float(acres)
                updated = True
            if lat and field.lat is None:
                field.lat = float(lat)
                updated = True
            if long and field.long is None:
                field.long = float(long)
                updated = True
            if updated:
                self.db.commit()

        # Check if field-season exists
        existing_fs = self.db.query(models.FieldSeason).filter(
            models.FieldSeason.field_id == field.field_id,
            models.FieldSeason.crop_id == crop.crop_id,
            models.FieldSeason.season_id == season.season_id,
            models.FieldSeason.variety_id == (variety.variety_id if variety else None),
        ).first()

        # Aggregate nutrient totals from row (they're pre-calculated in the CSV)
        totalN = row.get('totalN_per_ac')
        totalP = row.get('totalP_per_ac')
        totalK = row.get('totalK_per_ac')

        # Also get yields
        yield_bu_ac = row.get('yield_bu_ac')
        yield_target = row.get('yield_target')

        fs_data = {
            'field_id': field.field_id,
            'crop_id': crop.crop_id,
            'variety_id': variety.variety_id if variety else None,
            'season_id': season.season_id,
            'yield_bu_ac': float(yield_bu_ac) if pd.notna(yield_bu_ac) else None,
            'yield_target': float(yield_target) if pd.notna(yield_target) else None,
            'totalN_per_ac': float(totalN) if pd.notna(totalN) else None,
            'totalP_per_ac': float(totalP) if pd.notna(totalP) else None,
            'totalK_per_ac': float(totalK) if pd.notna(totalK) else None,
            'record_source': source_filename,
            'data_quality_score': 1.0,
        }

        if existing_fs:
            # Update with new data (prefer non-null values)
            for key, value in fs_data.items():
                if value is not None and getattr(existing_fs, key) is None:
                    setattr(existing_fs, key, value)
            self.db.commit()
            action = 'updated'
        else:
            # Create new field-season
            fs = models.FieldSeason(**fs_data)
            self.db.add(fs)
            self.db.flush()  # To get field_season_id
            action = 'inserted'

        # Now create management event if row represents an operation
        event_type = str(row.get('type', '')).strip()
        if event_type and pd.notna(event_type):
            self._create_management_event(row, fs.field_season_id, row_num)

        return action

    def _create_management_event(self, row: pd.Series, field_season_id: int, row_num: int):
        """Create a management event from a row."""
        event_type = str(row.get('type', '')).strip()
        if not event_type:
            return

        # Parse dates
        start_date = self.parse_date(row.get('start'))
        end_date = self.parse_date(row.get('end'))

        # Build event
        event_data = {
            'field_season_id': field_season_id,
            'job_id': int(row.get('job_id')) if pd.notna(row.get('job_id')) else None,
            'event_type': event_type,
            'status': str(row.get('status', '')) if pd.notna(row.get('status')) else None,
            'start_date': start_date,
            'end_date': end_date,
            'application_area': float(row.get('application_area')) if pd.notna(row.get('application_area')) else None,
            'amount': float(row.get('amount')) if pd.notna(row.get('amount')) else None,
            'description': str(row.get('description', '')) if pd.notna(row.get('description')) else None,
            'fert_units': str(row.get('fert_units', '')) if pd.notna(row.get('fert_units')) else None,
            'rate': float(row.get('rate')) if pd.notna(row.get('rate')) else None,
            'fertilizer_id': int(row.get('fertilizer_id')) if pd.notna(row.get('fertilizer_id')) else None,
            'blend_name': str(row.get('blend_name', '')) if pd.notna(row.get('blend_name')) else None,
            'chemical_type': str(row.get('chemical_type', '')) if pd.notna(row.get('chemical_type')) else None,
            'chem_product': str(row.get('chem_product', '')) if pd.notna(row.get('chem_product')) else None,
            'chem_units': str(row.get('chem_units', '')) if pd.notna(row.get('chem_units')) else None,
            'actives': row.get('actives') if pd.notna(row.get('actives')) else None,
            'water_applied_mm': float(row.get('water_applied_mm')) if pd.notna(row.get('water_applied_mm')) else None,
            'irrigation_method': str(row.get('irrigation_method', '')) if pd.notna(row.get('irrigation_method')) else None,
            'machine_make1': str(row.get('machine_make1', '')) if pd.notna(row.get('machine_make1')) else None,
            'machine_model1': str(row.get('machine_model1', '')) if pd.notna(row.get('machine_model1')) else None,
            'machine_type1': str(row.get('machine_type1', '')) if pd.notna(row.get('machine_type1')) else None,
            'scout_count': int(row.get('scout_count')) if pd.notna(row.get('scout_count')) else None,
        }

        event = models.ManagementEvent(**event_data)
        self.db.add(event)
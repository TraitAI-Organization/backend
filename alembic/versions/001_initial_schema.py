"""Initial schema creation

Revision ID: 001
Revises: 
Create Date: 2025-02-11 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # This file is a placeholder - actual schema is defined in app/database/models.py
    # When running alembic upgrade head, it will create all tables from Base.metadata
    pass

def downgrade() -> None:
    # Drop all tables in reverse order
    from app.database.models import Base
    op.drop_constraint('uq_field_season', 'field_seasons', type_='unique')
    op.drop_constraint('uq_prediction_field_model', 'model_predictions', type_='unique')
    op.drop_constraint('uq_variety_crop', 'varieties', type_='unique')
    
    op.drop_index('idx_model_predictions_field_season', table_name='model_predictions')
    op.drop_index('idx_model_predictions_model', table_name='model_predictions')
    op.drop_index('idx_management_events_field_season', table_name='management_events')
    op.drop_index('idx_management_events_type', table_name='management_events')
    op.drop_index('idx_fields_geo', table_name='fields')
    op.drop_index('idx_fields_state_county', table_name='fields')
    op.drop_index('idx_field_seasons_yield', table_name='field_seasons')
    op.drop_index('idx_field_seasons_crop', table_name='field_seasons')
    op.drop_index('idx_field_seasons_season', table_name='field_seasons')
    op.drop_index('idx_field_seasons_field', table_name='field_seasons')
    
    op.drop_table('model_predictions')
    op.drop_table('model_versions')
    op.drop_table('training_runs')
    op.drop_table('export_logs')
    op.drop_table('data_ingestion_log')
    op.drop_table('management_events')
    op.drop_table('field_seasons')
    op.drop_table('seasons')
    op.drop_table('varieties')
    op.drop_table('crops')
    op.drop_table('fields')
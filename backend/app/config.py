"""
Application configuration using Pydantic Settings
"""
from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    model_config = ConfigDict(
        protected_namespaces=(),
        env_file=".env",
        env_prefix=""
    )

    # Database
    database_url: str = "postgresql://nutrition:password@localhost:5432/nutrition_ai"
    postgres_user: str = "nutrition"
    postgres_password: str = "password"
    postgres_db: str = "nutrition_ai"

    # API
    secret_key: str = "change-this-in-production"
    access_token_expire_minutes: int = 30
    cors_origins: str = "*"
    cors_allow_credentials: bool = False

    # Model
    model_path: str = "models/"
    model_version: str = "v1.0.0"

    # Environment
    environment: str = "development"
    debug: bool = True

    # Redis (optional)
    redis_url: str = "redis://localhost:6379/0"

    # Admin
    admin_api_key: Optional[str] = None

    # UI configuration
    ui_config_path: str = "data/ui_config.json"

    # Firebase Auth (for verifying ID tokens on protected routes)
    # firebase_project_id: required to enable verification.
    # firebase_credentials_path: optional path to a service-account JSON. If
    #   unset, firebase-admin falls back to the GOOGLE_APPLICATION_CREDENTIALS
    #   env var or to Application Default Credentials.
    firebase_project_id: Optional[str] = None
    firebase_credentials_path: Optional[str] = None

    # USDA NASS Quick Stats (free key from https://quickstats.nass.usda.gov/api/).
    # If unset, the /season-status endpoint falls back to calendar-derived
    # estimates instead of live survey data.
    nass_api_key: Optional[str] = None
    # Cache TTL for NASS responses. NASS only publishes once a week (Monday 4pm
    # ET during the growing season), so a 6-hour TTL is plenty conservative and
    # keeps us comfortably under the 50k-row request cap.
    nass_cache_ttl_seconds: int = 6 * 60 * 60


settings = Settings()

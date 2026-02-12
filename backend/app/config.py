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

    # Model
    model_path: str = "models/"
    model_version: str = "v1.0.0"

    # Environment
    environment: str = "development"
    debug: bool = True

    # Redis (optional)
    redis_url: str = "redis://localhost:6379/0"


settings = Settings()
"""
Security utilities (basic - can be expanded with real auth)
"""
from datetime import datetime, timedelta
from typing import Optional
import secrets

from app.config import settings


def generate_api_key() -> str:
    """Generate a random API key."""
    return secrets.token_urlsafe(32)


def verify_api_key(api_key: str, valid_key: str) -> bool:
    """Verify an API key (simple implementation)."""
    return api_key == valid_key


# Placeholder for future JWT implementation
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create JWT access token (to be implemented with python-jose).
    For MVP, we'll just return a dummy token.
    """
    return "dummy_token"


def decode_access_token(token: str) -> dict:
    """
    Decode and validate JWT token.
    """
    # TODO: Implement with python-jose[cryptography]
    return {"sub": "user", "exp": datetime.utcnow() + timedelta(minutes=30)}
"""
Firebase Auth ID-token verification dependency for FastAPI.

Validates an ID token issued by the Firebase project configured in .env. Use it
on protected routes:

    from app.core.firebase_auth import require_firebase_user, FirebaseUser

    @router.get("/me")
    def me(user: FirebaseUser = Depends(require_firebase_user)):
        return {"uid": user.uid, "email": user.email}

Required settings (see app/config.py):
    - FIREBASE_PROJECT_ID    (mandatory once verification is desired)
    - FIREBASE_CREDENTIALS_PATH (optional — falls back to ADC / GOOGLE_APPLICATION_CREDENTIALS)

If FIREBASE_PROJECT_ID is unset, requests to protected routes return 503 with
a clear message rather than silently allowing every request through.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

logger = logging.getLogger(__name__)

# auto_error=False so we can return our own 401 with a clearer message.
_bearer = HTTPBearer(auto_error=False)

_init_lock = threading.Lock()
_initialized = False


@dataclass(frozen=True)
class FirebaseUser:
    """Subset of the Firebase ID-token claims used downstream."""

    uid: str
    email: Optional[str]
    email_verified: bool
    raw_claims: dict


def _ensure_initialized() -> None:
    """
    Initialize the firebase-admin app exactly once per process.

    Imports firebase_admin lazily so that the import error surfaces only when
    auth is actually requested (keeps `pip install` optional for users who
    haven't enabled Firebase yet).
    """
    global _initialized
    if _initialized:
        return

    with _init_lock:
        if _initialized:
            return

        if not settings.firebase_project_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Firebase auth is not configured. Set FIREBASE_PROJECT_ID in .env "
                    "(and optionally FIREBASE_CREDENTIALS_PATH)."
                ),
            )

        try:
            import firebase_admin
            from firebase_admin import credentials
        except ImportError as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"firebase-admin is not installed: {e}. Run `pip install -r requirements.txt`.",
            )

        # If the app was already initialized elsewhere, reuse it.
        if firebase_admin._apps:
            _initialized = True
            return

        cred = None
        if settings.firebase_credentials_path:
            cred = credentials.Certificate(settings.firebase_credentials_path)
        # If cred is None, firebase-admin will use Application Default Credentials
        # (env var GOOGLE_APPLICATION_CREDENTIALS or the runtime's default identity).

        firebase_admin.initialize_app(
            credential=cred,
            options={"projectId": settings.firebase_project_id},
        )
        _initialized = True
        logger.info("firebase-admin initialized for project %s", settings.firebase_project_id)


def verify_firebase_token(token: str) -> FirebaseUser:
    """
    Verify a Firebase ID token and return the parsed user.

    firebase-admin handles signature verification (against Google's public keys),
    issuer/audience checks (must match `https://securetoken.google.com/<projectId>`
    and `<projectId>` respectively), and expiry. We only translate the result into
    our domain object and convert errors into proper HTTP responses.
    """
    _ensure_initialized()

    try:
        from firebase_admin import auth as fb_auth
    except ImportError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    try:
        # check_revoked=False to avoid the round-trip to Firebase on every call.
        # Switch to True if you want immediate revocation enforcement.
        decoded = fb_auth.verify_id_token(token, check_revoked=False)
    except fb_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except fb_auth.RevokedIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")
    except fb_auth.InvalidIdTokenError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}")
    except Exception as e:  # noqa: BLE001 — surface anything else as 401
        logger.exception("Firebase token verification failed")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Token verification failed: {e}")

    return FirebaseUser(
        uid=decoded.get("uid", ""),
        email=decoded.get("email"),
        email_verified=bool(decoded.get("email_verified", False)),
        raw_claims=decoded,
    )


def require_firebase_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> FirebaseUser:
    """FastAPI dependency that returns the verified FirebaseUser, or raises 401."""
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_firebase_token(credentials.credentials)

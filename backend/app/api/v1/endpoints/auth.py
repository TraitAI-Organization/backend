"""
Auth endpoints. Sign-in / sign-out happen client-side via Firebase Auth; the
backend only verifies ID tokens. This module exposes a /me smoke-test endpoint
that protected routes can be patterned after.
"""
from fastapi import APIRouter, Depends

from app.core.firebase_auth import FirebaseUser, require_firebase_user

router = APIRouter()


@router.get("/me")
def get_current_user(user: FirebaseUser = Depends(require_firebase_user)):
    """
    Return the verified Firebase user. Useful as a smoke test that the frontend's
    ID token is accepted by the backend, and as a way to fetch the canonical
    user identifier (`uid`) for downstream relations.
    """
    return {
        "uid": user.uid,
        "email": user.email,
        "email_verified": user.email_verified,
    }

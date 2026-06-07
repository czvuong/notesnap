"""
auth.py — Clerk JWT verification for FastAPI.

How it works:
  1. Clerk signs every session token (JWT) with a private key.
  2. Clerk publishes the matching public keys at a JWKS endpoint.
  3. We fetch those public keys once (cached) and use them to verify
     every incoming JWT without making a network call per request.
  4. The get_current_user dependency extracts the user_id (Clerk's
     stable identifier, the "sub" claim) from the verified token.

Usage in a route:
    from auth import get_current_user

    @router.get("/something")
    def my_route(current_user: str = Depends(get_current_user)):
        # current_user is the Clerk user_id string, e.g. "user_2abc..."
        ...
"""

import httpx
import logging
from functools import lru_cache
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import settings

logger = logging.getLogger(__name__)

# Clerk's JWKS endpoint — public keys used to verify JWTs.
# The secret key is used to derive the issuer URL.
# Format: https://<frontend-api>.clerk.accounts.dev
_JWKS_URL_TEMPLATE = "https://{instance_id}.clerk.accounts.dev/.well-known/jwks.json"

bearer_scheme = HTTPBearer()


@lru_cache(maxsize=1)
def _get_jwks() -> dict:
    """
    Fetch Clerk's public keys from their JWKS endpoint.
    Cached for the lifetime of the process — keys rarely rotate.
    Call _get_jwks.cache_clear() if you ever need to force a refresh.

    Uses CLERK_JWKS_URL set directly in environment variables.
    Example: https://fresh-pangolin-54.clerk.accounts.dev/.well-known/jwks.json
    """
    jwks_url = settings.CLERK_JWKS_URL
    if not jwks_url:
        raise RuntimeError(
            "CLERK_JWKS_URL is not set in environment variables. "
            "Set it to your Clerk instance's JWKS endpoint, e.g. "
            "https://<instance>.clerk.accounts.dev/.well-known/jwks.json"
        )
    logger.info("Fetching JWKS from: %s", jwks_url)
    try:
        response = httpx.get(jwks_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        logger.info("JWKS fetched successfully, got %d key(s)", len(data.get("keys", [])))
        return data
    except httpx.HTTPStatusError as e:
        logger.error("JWKS endpoint returned HTTP %s: %s", e.response.status_code, e.response.text)
        raise RuntimeError(f"JWKS endpoint returned HTTP {e.response.status_code}") from e
    except httpx.RequestError as e:
        logger.error("JWKS network error (%s): %s", type(e).__name__, e)
        raise RuntimeError(f"Could not reach JWKS endpoint: {type(e).__name__}: {e}") from e
    except Exception as e:
        logger.error("JWKS unexpected exception (%s): %s", type(e).__name__, e, exc_info=True)
        raise RuntimeError(f"Unexpected JWKS error: {type(e).__name__}: {e}") from e


from typing import Optional, Tuple


# ── Clerk Backend API helpers ─────────────────────────────────────────────────

# Simple in-process cache: user_id → email.  Never evicted, but that is fine
# for a course project — user emails rarely change, and the process restarts
# often enough in dev.  Use a proper TTL cache (e.g. cachetools) for production.
_user_email_cache: dict[str, Optional[str]] = {}


def _fetch_email_from_clerk(user_id: str) -> Optional[str]:
    """
    Call Clerk's Backend API to retrieve the primary email address for a user.
    Requires CLERK_SECRET_KEY.  Returns None on any error so callers degrade
    gracefully rather than failing the whole request.
    """
    if not settings.CLERK_SECRET_KEY:
        return None
    if user_id in _user_email_cache:
        return _user_email_cache[user_id]
    try:
        resp = httpx.get(
            f"https://api.clerk.com/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {settings.CLERK_SECRET_KEY}"},
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            primary_id = data.get("primary_email_address_id")
            for addr in data.get("email_addresses", []):
                if addr.get("id") == primary_id:
                    email = addr.get("email_address", "").strip().lower() or None
                    _user_email_cache[user_id] = email
                    return email
    except Exception as exc:
        logger.debug("Clerk email lookup failed for %s: %s", user_id, exc)
    _user_email_cache[user_id] = None
    return None


def _verify_token(token: str) -> Tuple[str, Optional[str]]:
    """
    Verify a Clerk JWT and return (user_id, email).
    email may be None if not present in the JWT claims.
    Raises HTTPException 401 if the token is invalid or expired.

    To include email in the JWT, add {{ user.primary_email_address }}
    to your Clerk session token template in the Clerk dashboard.
    """
    if not settings.CLERK_SECRET_KEY:
        # No Clerk secret key configured — running in local dev mode.
        return "dev_user", "dev@example.com"

    try:
        jwks = _get_jwks()
    except RuntimeError as e:
        logger.error("JWKS fetch failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Auth configuration error: {e}",
        )

    try:
        # Decode without verifying audience — Clerk JWTs don't always
        # include a standard 'aud' claim.
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject claim.",
            )
        # Clerk can include email in the JWT via a custom session token template.
        # Falls back to None if not configured — invite matching will then rely
        # solely on invitee_user_id after the first accepted-invite lookup.
        email: Optional[str] = payload.get("email") or payload.get("primary_email_address")
        return user_id, email
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """
    FastAPI dependency. Returns the Clerk user_id string.
    Existing routes use this — no change needed there.
    """
    user_id, _ = _verify_token(credentials.credentials)
    return user_id


def get_current_user_info(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> Tuple[str, Optional[str]]:
    """
    FastAPI dependency. Returns (user_id, email).
    Use this in routes that need to match email-based invites.

    Email is sourced from (in priority order):
      1. JWT claims (fast, zero extra network calls — preferred)
      2. Clerk Backend API (one HTTP call, cached per user_id per process)

    Inject:
        current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info)
        user_id, email = current_user_info
    """
    user_id, email = _verify_token(credentials.credentials)
    # If the JWT template doesn't include email, fall back to Clerk's Backend API.
    if not email:
        email = _fetch_email_from_clerk(user_id)
    return user_id, email

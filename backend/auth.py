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


def _verify_token(token: str) -> str:
    """
    Verify a Clerk JWT and return the user_id (the 'sub' claim).
    Raises HTTPException 401 if the token is invalid or expired.
    """
    if not settings.CLERK_SECRET_KEY:
        # No Clerk secret key configured — running in local dev mode.
        # Return a hardcoded dev user_id so routes still work locally.
        return "dev_user"

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
        return user_id
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """
    FastAPI dependency. Extracts and verifies the Bearer token from the
    Authorization header. Returns the Clerk user_id string.

    Inject into any route that requires authentication:
        current_user: str = Depends(get_current_user)
    """
    return _verify_token(credentials.credentials)

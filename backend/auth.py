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
from functools import lru_cache
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import settings

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

    Uses the public JWKS endpoint derived from the publishable key, which
    requires no authentication. The publishable key encodes the Clerk
    instance domain in base64 after the 'pk_test_' prefix.
    """
    # Decode the instance domain from the publishable key.
    # pk_test_<base64(domain + "$")> → strip prefix, decode, strip trailing "$"
    import base64
    from config import settings as _s

    pub_key = _s.CLERK_PUBLISHABLE_KEY
    b64_part = pub_key.split("_", 2)[-1]          # strip "pk_test_" or "pk_live_"
    # Add padding if needed
    padded = b64_part + "=" * (-len(b64_part) % 4)
    domain = base64.b64decode(padded).decode("utf-8").rstrip("$")
    jwks_url = f"https://{domain}/.well-known/jwks.json"

    response = httpx.get(jwks_url, timeout=10)
    response.raise_for_status()
    return response.json()


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

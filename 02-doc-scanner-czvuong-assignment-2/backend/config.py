"""
config.py — Centralized settings loaded from the .env file.

Using pydantic-settings means every setting is type-checked and validated
at startup. If a required variable is missing, the app fails immediately
with a clear error rather than crashing mysteriously at runtime.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    # AI provider
    AI_PROVIDER: str = "tritonai"            # "tritonai" | "anthropic"

    # TritonAI (OpenAI-compatible)
    TRITONAI_API_KEY: str = ""
    TRITONAI_BASE_URL: str = "https://tritonai.ucsd.edu/api/v1"

    # Two-step pipeline models (recommended TritonAI setup):
    #   OCR model    — takes image input, returns raw extracted text (free on input)
    #   Text model   — takes text input only, returns structured JSON / summaries / flashcards
    #   Vision model — fallback when OCR fails; supports image input AND text output
    TRITONAI_OCR_MODEL: str = "api-lightonocr-1b"
    TRITONAI_TEXT_MODEL: str = "api-gpt-oss-120b"
    TRITONAI_VISION_MODEL: str = "api-mistral-small-3.2-2506"  # has Vision capability

    # Legacy single-model field kept for Anthropic parity reference only
    TRITONAI_MODEL: str = "api-gpt-oss-120b"

    # Anthropic direct
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"

    # Database
    DATABASE_URL: str = "sqlite:///./notesnap.db"

    # CORS — comma-separated list of allowed origins
    CORS_ORIGINS: str = "http://localhost:5173"

    # Upload limits
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024   # 10 MB

    # Soft-delete TTL
    SOFT_DELETE_TTL_DAYS: int = 7

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache()
def get_settings() -> Settings:
    """
    Cached settings instance — the .env file is only read once.
    Use `get_settings()` anywhere you need config outside of FastAPI DI.
    """
    return Settings()


# Module-level singleton for convenience
settings = get_settings()

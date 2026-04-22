from pydantic_settings import BaseSettings
from typing import Literal
import os
import sys

_INSECURE_JWT_DEFAULTS = {
    "dev-secret-change-in-production",
    "change-me",
    "secret",
    "changeme",
}

_INSECURE_DB_PASSWORDS = {"portal123", "postgres", "password", "admin", "root"}


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://portal:portal123@localhost:5432/mst_portal"

    # Auth
    AUTH_MODE: Literal["open", "ldap", "saml"] = "open"
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24  # 24h for dev, 8h for prod

    # LDAP (only used when AUTH_MODE=ldap)
    LDAP_URL: str = ""
    LDAP_BASE_DN: str = ""

    # SAML / ADFS (only used when AUTH_MODE=saml)
    SAML_SETTINGS_PATH: str = os.path.join(os.path.dirname(__file__), "saml", "settings.json")
    SAML_SP_ENTITY_ID: str = "https://mst-ai-portal.ai.x.net/saml/metadata"
    SAML_SP_ACS_URL: str = "https://mst-ai-portal.ai.x.net/saml/acs"
    SAML_SP_SLS_URL: str = "https://mst-ai-portal.ai.x.net/saml/sls"
    SAML_IDP_ENTITY_ID: str = ""        # https://adfs.x.net/adfs/services/trust
    SAML_IDP_SSO_URL: str = ""          # https://adfs.x.net/adfs/ls/
    SAML_IDP_SLO_URL: str = ""          # https://adfs.x.net/adfs/ls/?wa=wsignout1.0
    SAML_IDP_CERT: str = ""             # base64 ADFS token-signing cert (no headers)
    SAML_SP_CERT: str = ""              # base64 SP public cert (no headers)
    SAML_SP_KEY: str = ""               # base64 SP private key (no headers)
    # AD group → portal role mapping  e.g. "AI-Ignite-Team=admin,Samsung-Developers=user"
    SAML_GROUP_ROLE_MAP: str = ""
    # If empty, any authenticated SAML user gets role "user"
    SAML_DEFAULT_ROLE: str = "user"
    # Strict mode — NEVER disable in production
    SAML_STRICT: bool = True

    # Storage paths
    VIDEO_STORAGE_PATH: str = os.path.join(os.path.dirname(__file__), "storage", "videos")
    MEDIA_STORAGE_PATH: str = os.path.join(os.path.dirname(__file__), "storage", "media")

    # Upload limits
    MAX_UPLOAD_SIZE_MB: int = 5120  # 5 GB (video files)
    MAX_ATTACHMENT_SIZE_MB: int = 100  # 100 MB (attachments)

    # Remotion banner
    REMOTION_BANNER_PATH: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "remotion-banner")

    # Transcode
    FFMPEG_PATH: str = "ffmpeg"
    FFMPEG_HWACCEL: str = "auto"  # "auto" = detect GPU, "none" = force CPU
    TRANSCODE_POLL_INTERVAL: int = 5  # seconds

    # LLM / Ollama
    # Use localhost by default for local runs; Docker compose overrides this to host.docker.internal.
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # Portal frontend URL (used for links in emails/newsletters)
    PORTAL_URL: str = "http://localhost:9810"

    # Email
    SMTP_SERVER: str = "localhost"
    SMTP_PORT: int = 1025  # Mailhog default
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@mst-ai-portal.local"
    SMTP_FROM_NAME: str = "MST AI Portal"

    # CORS — CORS_ORIGINS defaults to wildcard (safe with Bearer tokens, no cookies)
    # Set CORS_ALLOW_ORIGIN_REGEX for fine-grained control (e.g. restrict to your domain)
    CORS_ORIGINS: list[str] = ["*"]
    CORS_ALLOW_ORIGIN_REGEX: str = ""

    # Seed default admin (open mode only). Set to "false" in production.
    SEED_DEFAULT_ADMIN: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()


def _check_insecure_defaults() -> None:
    """Abort startup if obviously insecure defaults are detected outside dev mode."""
    env = os.environ.get("ENV", "development").lower()
    if env in ("development", "dev", "test"):
        return

    errors = []
    if settings.JWT_SECRET in _INSECURE_JWT_DEFAULTS:
        errors.append("JWT_SECRET is set to an insecure default value")

    db_url = settings.DATABASE_URL
    for pw in _INSECURE_DB_PASSWORDS:
        if f":{pw}@" in db_url:
            errors.append(f"DATABASE_URL contains insecure password '{pw}'")
            break

    if errors:
        for e in errors:
            print(f"[FATAL] {e}", file=sys.stderr)
        print("[FATAL] Set ENV=development to bypass this check during local development.", file=sys.stderr)
        sys.exit(1)


_check_insecure_defaults()

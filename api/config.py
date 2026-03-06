from pydantic_settings import BaseSettings
from typing import Literal
import os


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://portal:portal123@localhost:5432/mst_portal"

    # Auth
    AUTH_MODE: Literal["open", "ldap"] = "open"
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24  # 24h for dev, 8h for prod

    # LDAP (only used when AUTH_MODE=ldap)
    LDAP_URL: str = ""
    LDAP_BASE_DN: str = ""

    # Storage paths
    VIDEO_STORAGE_PATH: str = os.path.join(os.path.dirname(__file__), "storage", "videos")
    MEDIA_STORAGE_PATH: str = os.path.join(os.path.dirname(__file__), "storage", "media")

    # Upload limits
    MAX_UPLOAD_SIZE_MB: int = 5120  # 5 GB

    # Transcode
    FFMPEG_PATH: str = "ffmpeg"
    TRANSCODE_POLL_INTERVAL: int = 5  # seconds

    # Server — use allow_origin_regex in middleware instead for dev
    CORS_ORIGINS: list[str] = ["*"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

from functools import lru_cache

from pydantic import Field, HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SailFish Collector"
    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    sailfish_base_url: str = "https://www.saill.cn"
    sailfish_tenant_id: str = "139"
    sailfish_username: str = ""
    sailfish_password: str = ""
    sailfish_live_token: str = ""

    token_encryption_key: str = ""
    snapshot_interval_seconds: int = 10
    raw_retention_days: int = 30
    wind_freshness_seconds: int = 5
    batch_flush_seconds: float = 1.0
    batch_size: int = 500

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


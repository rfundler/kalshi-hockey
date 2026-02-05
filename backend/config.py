from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    kalshi_api_key: str = ""
    api_key_id: str = ""  # Alternative name
    kalshi_private_key_path: str = ""  # Path to key file (local)
    kalshi_private_key: str = ""  # Key content directly (Railway)
    private_key_pem: str = ""  # Alternative name
    kalshi_env: str = "prod"  # "demo" or "prod"

    @property
    def effective_api_key(self) -> str:
        return self.kalshi_api_key or self.api_key_id

    @property
    def effective_private_key(self) -> str:
        return self.kalshi_private_key or self.private_key_pem
    demo_mode: bool = True  # Set to False when ready to use real API

    @property
    def kalshi_api_base(self) -> str:
        if self.kalshi_env == "prod":
            return "https://api.elections.kalshi.com/trade-api/v2"
        return "https://demo-api.kalshi.co/trade-api/v2"

    @property
    def kalshi_ws_url(self) -> str:
        if self.kalshi_env == "prod":
            return "wss://api.elections.kalshi.com/trade-api/ws/v2"
        return "wss://demo-api.kalshi.co/trade-api/ws/v2"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    kalshi_api_key: str = ""
    kalshi_private_key_path: str = ""  # Path to key file (local)
    kalshi_private_key: str = ""  # Key content directly (Railway)
    kalshi_env: str = "demo"  # "demo" or "prod"
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

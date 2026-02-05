import httpx
import asyncio
import json
from typing import Optional, Callable
import websockets
from auth import KalshiAuth
from config import get_settings


class KalshiClient:
    def __init__(self):
        settings = get_settings()
        self.base_url = settings.kalshi_api_base
        self.ws_url = settings.kalshi_ws_url
        self.auth = KalshiAuth(
            api_key=settings.kalshi_api_key,
            private_key_path=settings.kalshi_private_key_path,
            private_key_content=settings.kalshi_private_key
        )
        self._http_client: Optional[httpx.AsyncClient] = None
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._ws_callbacks: dict[str, Callable] = {}

    async def get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    async def _request(self, method: str, path: str, data: dict = None) -> dict:
        client = await self.get_http_client()
        url = f"{self.base_url}{path}"
        headers = self.auth.get_auth_headers(method, f"/trade-api/v2{path}")

        if method == "GET":
            response = await client.get(url, headers=headers)
        elif method == "POST":
            response = await client.post(url, headers=headers, json=data)
        elif method == "DELETE":
            response = await client.delete(url, headers=headers)
        else:
            raise ValueError(f"Unsupported method: {method}")

        response.raise_for_status()
        return response.json() if response.text else {}

    async def get_orderbook(self, ticker: str) -> dict:
        return await self._request("GET", f"/markets/{ticker}/orderbook")

    async def get_market(self, ticker: str) -> dict:
        return await self._request("GET", f"/markets/{ticker}")

    async def search_markets(self, query: str, limit: int = 20) -> dict:
        """Search markets by keyword."""
        return await self._request("GET", f"/markets?limit={limit}")

    async def get_event_markets(self, event_ticker: str) -> dict:
        """Get all markets for an event."""
        return await self._request("GET", f"/markets?event_ticker={event_ticker}")

    async def place_order(
        self,
        ticker: str,
        side: str,  # "yes" or "no"
        action: str,  # "buy" or "sell"
        count: int,
        price: int,  # In cents
        order_type: str = "limit"
    ) -> dict:
        data = {
            "ticker": ticker,
            "side": side,
            "action": action,
            "count": count,
            "type": order_type,
        }
        if order_type == "limit":
            data["yes_price"] = price if side == "yes" else None
            data["no_price"] = price if side == "no" else None

        return await self._request("POST", "/portfolio/orders", data)

    async def cancel_order(self, order_id: str) -> dict:
        return await self._request("DELETE", f"/portfolio/orders/{order_id}")

    async def get_positions(self) -> dict:
        return await self._request("GET", "/portfolio/positions")

    async def get_balance(self) -> dict:
        return await self._request("GET", "/portfolio/balance")

    async def connect_websocket(self, on_message: Callable):
        headers = self.auth.get_auth_headers("GET", "/trade-api/ws/v2")
        ws_headers = [
            ("KALSHI-ACCESS-KEY", headers["KALSHI-ACCESS-KEY"]),
            ("KALSHI-ACCESS-SIGNATURE", headers["KALSHI-ACCESS-SIGNATURE"]),
            ("KALSHI-ACCESS-TIMESTAMP", headers["KALSHI-ACCESS-TIMESTAMP"]),
        ]

        self._ws = await websockets.connect(self.ws_url, extra_headers=ws_headers)

        async for message in self._ws:
            data = json.loads(message)
            await on_message(data)

    async def subscribe(self, channels: list[str], tickers: list[str]):
        if self._ws:
            msg = {
                "id": 1,
                "cmd": "subscribe",
                "params": {
                    "channels": channels,
                    "market_tickers": tickers
                }
            }
            await self._ws.send(json.dumps(msg))

    async def close(self):
        if self._http_client:
            await self._http_client.aclose()
        if self._ws:
            await self._ws.close()


# Singleton instance
_client: Optional[KalshiClient] = None


def get_kalshi_client() -> KalshiClient:
    global _client
    if _client is None:
        _client = KalshiClient()
    return _client

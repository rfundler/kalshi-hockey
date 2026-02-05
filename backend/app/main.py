"""FastAPI backend for Kalshi Trading Dashboard."""

import base64
import time
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend
import httpx


class Settings(BaseSettings):
    api_key_id: str = ""
    private_key_pem: str = ""
    kalshi_api_base: str = "https://api.elections.kalshi.com/trade-api/v2"
    demo_mode: str = "false"
    kalshi_env: str = "prod"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()


class KalshiClient:
    def __init__(self):
        self.base_url = settings.kalshi_api_base
        self._private_key = None
        self._client = None

    @property
    def private_key(self):
        if self._private_key is None:
            key_pem = settings.private_key_pem.replace("\\n", "\n").encode()
            self._private_key = serialization.load_pem_private_key(key_pem, password=None, backend=default_backend())
        return self._private_key

    @property
    def client(self):
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def _sign(self, method: str, path: str, timestamp: int) -> str:
        message = f"{timestamp}{method}{path}".encode('utf-8')
        signature = self.private_key.sign(
            message,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256()
        )
        return base64.b64encode(signature).decode('utf-8')

    def _headers(self, method: str, path: str) -> dict:
        ts = int(time.time() * 1000)
        sign_path = f"/trade-api/v2{path}"
        return {
            "KALSHI-ACCESS-KEY": settings.api_key_id,
            "KALSHI-ACCESS-SIGNATURE": self._sign(method, sign_path, ts),
            "KALSHI-ACCESS-TIMESTAMP": str(ts),
            "Content-Type": "application/json"
        }

    async def request(self, method: str, path: str, params=None, json_data=None):
        headers = self._headers(method.upper(), path)
        url = f"{self.base_url}{path}"
        resp = await self.client.request(method, url, headers=headers, params=params, json=json_data)
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        if self._client:
            await self._client.aclose()


client = KalshiClient()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await client.close()


app = FastAPI(title="Kalshi Trading Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OrderRequest(BaseModel):
    ticker: str
    side: str
    action: str
    count: int
    type: str = "limit"
    yes_price: Optional[int] = None
    no_price: Optional[int] = None


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/balance")
async def get_balance():
    try:
        return await client.request("GET", "/portfolio/balance")
    except httpx.HTTPStatusError as e:
        return {"error": True, "status_code": e.response.status_code, "detail": e.response.text[:500]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/categories")
async def get_categories():
    """Get categories."""
    return {
        "categories": ["Mentions"]
    }


@app.get("/api/events")
async def get_events(category: Optional[str] = None, search: Optional[str] = None, limit: int = 50):
    """Get Mentions markets grouped by event with full titles."""
    try:
        all_items = []
        seen_events = set()

        # Fetch Mentions series
        series_result = await client.request("GET", "/series", params={"limit": 100, "category": "Mentions"})

        for series in series_result.get("series", []):
            series_ticker = series.get("ticker")

            # Get markets for this series
            try:
                markets_result = await client.request("GET", "/markets", params={"series_ticker": series_ticker, "limit": 200})
                markets = markets_result.get("markets", [])

                # Group markets by event_ticker
                events_map = {}
                for m in markets:
                    if m.get("status") != "active" or m.get("mve_collection_ticker"):
                        continue

                    event_ticker = m.get("event_ticker", "")
                    if not event_ticker or event_ticker in seen_events:
                        continue

                    if event_ticker not in events_map:
                        events_map[event_ticker] = {
                            "ticker": event_ticker,
                            "title": m.get("title", ""),  # Use first market's title as base
                            "category": "Mentions",
                            "type": "event",
                            "markets": []
                        }
                    events_map[event_ticker]["markets"].append(m)

                # Fetch actual event titles and add to results
                for event_ticker, event_data in events_map.items():
                    if len(event_data["markets"]) > 0:
                        # Try to get the real event title
                        try:
                            event_result = await client.request("GET", f"/events/{event_ticker}")
                            event_info = event_result.get("event", {})
                            event_data["title"] = event_info.get("title", event_data["title"])
                        except:
                            # Fallback: construct title from market title
                            first_market = event_data["markets"][0]
                            event_data["title"] = first_market.get("title", "").split("say")[0] + "say...?" if "say" in first_market.get("title", "").lower() else first_market.get("title", "")

                        if search and search.lower() not in event_data["title"].lower():
                            continue

                        event_data["markets"].sort(key=lambda m: m.get("close_time", ""))
                        event_data["markets"] = event_data["markets"][:20]
                        all_items.append(event_data)
                        seen_events.add(event_ticker)

            except:
                pass

            if len(all_items) >= limit:
                break

        # Sort by number of markets
        all_items.sort(key=lambda e: -len(e.get("markets", [])))

        return {"events": all_items[:limit]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/event/{ticker}")
async def get_event_detail(ticker: str, type: str = "event"):
    """Get full event or series details with all active markets."""
    try:
        if type == "series":
            # Fetch series markets
            series_result = await client.request("GET", f"/series/{ticker}")
            series = series_result.get("series", {})

            markets_result = await client.request("GET", "/markets", params={"series_ticker": ticker, "limit": 200})
            markets = markets_result.get("markets", [])

            active_markets = [
                m for m in markets
                if m.get("status") == "active" and not m.get("mve_collection_ticker")
            ]
            active_markets.sort(key=lambda m: m.get("close_time", ""))

            return {
                "ticker": ticker,
                "title": series.get("title"),
                "category": series.get("category"),
                "markets": active_markets
            }
        else:
            # Fetch event markets
            result = await client.request("GET", f"/events/{ticker}", params={"with_nested_markets": True})
            event = result.get("event", {})

            markets = event.get("markets", [])
            active_markets = [m for m in markets if m.get("status") == "active"]
            active_markets.sort(key=lambda m: m.get("close_time", ""))

            return {
                "ticker": event.get("ticker"),
                "title": event.get("title"),
                "category": event.get("category"),
                "markets": active_markets
            }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/markets/{ticker}/orderbook")
async def get_orderbook(ticker: str, depth: int = 10):
    try:
        return await client.request("GET", f"/markets/{ticker}/orderbook", params={"depth": depth})
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/markets/{ticker}/history")
async def get_market_history(ticker: str, min_ts: Optional[int] = None, max_ts: Optional[int] = None, period_interval: int = 60):
    """Get price history/candlesticks for a market. period_interval in minutes (1, 60, 1440)."""
    try:
        # Parse series_ticker from market ticker (e.g., KXNFLMENTION-SB26-WIND -> KXNFLMENTION-SB26)
        parts = ticker.rsplit("-", 1)
        if len(parts) == 2:
            series_ticker = parts[0]
        else:
            series_ticker = ticker

        # Set default time range based on period_interval
        end_ts = max_ts or int(time.time())
        if min_ts:
            start_ts = min_ts
        else:
            # Default ranges: 1min=2hrs, 60min=7days, 1440min=30days
            if period_interval == 1:
                start_ts = end_ts - (2 * 60 * 60)
            elif period_interval == 60:
                start_ts = end_ts - (7 * 24 * 60 * 60)
            else:
                start_ts = end_ts - (30 * 24 * 60 * 60)

        params = {
            "period_interval": period_interval,
            "start_ts": start_ts,
            "end_ts": end_ts
        }
        result = await client.request("GET", f"/series/{series_ticker}/markets/{ticker}/candlesticks", params=params)

        # Transform to simpler format for frontend
        candlesticks = result.get("candlesticks", [])
        history = []
        for c in candlesticks:
            history.append({
                "ts": c.get("end_period_ts", 0),
                "yes_price": c.get("price", {}).get("close", 0),
                "yes_bid": c.get("yes_bid", {}).get("close", 0),
                "yes_ask": c.get("yes_ask", {}).get("close", 0),
                "volume": c.get("volume", 0),
                "open_interest": c.get("open_interest", 0)
            })
        return {"history": history}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/markets/{ticker}/trades")
async def get_market_trades(ticker: str, limit: int = 100, min_ts: Optional[int] = None, max_ts: Optional[int] = None):
    """Get recent public trades for a market."""
    try:
        params = {"ticker": ticker, "limit": limit}
        if min_ts:
            params["min_ts"] = min_ts
        if max_ts:
            params["max_ts"] = max_ts
        return await client.request("GET", "/markets/trades", params=params)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/markets/{ticker}")
async def get_market(ticker: str):
    """Get market details."""
    try:
        return await client.request("GET", f"/markets/{ticker}")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/orders")
async def create_order(order: OrderRequest):
    try:
        data = {
            "ticker": order.ticker,
            "side": order.side,
            "action": order.action,
            "count": order.count,
            "type": order.type,
        }
        if order.yes_price:
            data["yes_price"] = order.yes_price
        if order.no_price:
            data["no_price"] = order.no_price
        return await client.request("POST", "/portfolio/orders", json_data=data)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/orders")
async def get_orders(status: str = "resting"):
    try:
        return await client.request("GET", "/portfolio/orders", params={"status": status})
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/orders/{order_id}")
async def cancel_order(order_id: str):
    try:
        return await client.request("DELETE", f"/portfolio/orders/{order_id}")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/positions")
async def get_positions():
    try:
        result = await client.request("GET", "/portfolio/positions")
        positions = result.get("market_positions", [])
        active_positions = [p for p in positions if p.get("position", 0) != 0]

        for pos in active_positions:
            ticker = pos.get("ticker")
            if ticker:
                try:
                    market = await client.request("GET", f"/markets/{ticker}")
                    pos["market_title"] = market.get("market", {}).get("title", ticker)
                    pos["yes_sub_title"] = market.get("market", {}).get("yes_sub_title", "")
                except:
                    pos["market_title"] = ticker

        return {"market_positions": active_positions}
    except Exception as e:
        raise HTTPException(500, str(e))

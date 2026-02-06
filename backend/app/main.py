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
async def get_events(category: Optional[str] = None, search: Optional[str] = None, limit: int = 50, series_ticker: Optional[str] = None):
    """Get markets grouped by event. If series_ticker provided, fetch that series directly."""
    try:
        all_items = []
        seen_events = set()

        # If series_ticker is provided, query that series directly
        if series_ticker:
            markets_result = await client.request("GET", "/markets", params={"series_ticker": series_ticker, "limit": 200})
            markets = markets_result.get("markets", [])

            # Group markets by event_ticker
            events_map = {}
            for m in markets:
                if m.get("status") != "active":
                    continue

                event_ticker = m.get("event_ticker", "")
                if not event_ticker:
                    continue

                if event_ticker not in events_map:
                    # Extract team names from title for hockey games
                    title = m.get("title", "")
                    events_map[event_ticker] = {
                        "ticker": event_ticker,
                        "title": title,
                        "category": m.get("category", "Sports"),
                        "type": "event",
                        "markets": []
                    }
                events_map[event_ticker]["markets"].append(m)

            # Fetch actual event titles
            for event_ticker, event_data in events_map.items():
                if len(event_data["markets"]) > 0:
                    try:
                        event_result = await client.request("GET", f"/events/{event_ticker}")
                        event_info = event_result.get("event", {})
                        event_data["title"] = event_info.get("title", event_data["title"])
                    except:
                        pass

                    if search and search.lower() not in event_data["title"].lower():
                        continue

                    event_data["markets"].sort(key=lambda m: m.get("close_time", ""))
                    all_items.append(event_data)
                    seen_events.add(event_ticker)

            all_items.sort(key=lambda e: e.get("ticker", ""))
            return {"events": all_items[:limit]}

        # Original behavior: Fetch Mentions series
        series_result = await client.request("GET", "/series", params={"limit": 100, "category": "Mentions"})

        for series in series_result.get("series", []):
            s_ticker = series.get("ticker")

            # Get markets for this series
            try:
                markets_result = await client.request("GET", "/markets", params={"series_ticker": s_ticker, "limit": 200})
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
                            "title": m.get("title", ""),
                            "category": "Mentions",
                            "type": "event",
                            "markets": []
                        }
                    events_map[event_ticker]["markets"].append(m)

                # Fetch actual event titles and add to results
                for event_ticker, event_data in events_map.items():
                    if len(event_data["markets"]) > 0:
                        try:
                            event_result = await client.request("GET", f"/events/{event_ticker}")
                            event_info = event_result.get("event", {})
                            event_data["title"] = event_info.get("title", event_data["title"])
                        except:
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


# ============== MOMENTUM BOT ==============

import asyncio
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class BotTrade:
    timestamp: str
    ticker: str
    event_ticker: str
    side: str  # "yes" or "no"
    price: int
    count: int
    trigger_price_change: int
    order_id: Optional[str] = None
    status: str = "pending"


class MomentumBot:
    def __init__(self):
        self.min_price_move: int = 10  # cents
        self.max_shares: int = 50
        self.poll_interval: float = 0.5  # seconds
        self.lookback_seconds: float = 1.0  # compare price to 1 second ago
        self.enabled_events: set = set()  # event_tickers with bot enabled
        self.event_markets: dict = {}  # event_ticker -> list of market tickers
        self.price_history: dict = {}  # market_ticker -> list of (timestamp, price)
        self.trades: list = []
        self._task: Optional[asyncio.Task] = None
        self._running: bool = False

    async def toggle_event(self, event_ticker: str, enable: bool):
        """Enable or disable bot for a specific event (game)."""
        if enable:
            # Get markets for this event
            try:
                markets_result = await client.request("GET", "/markets", params={"event_ticker": event_ticker, "limit": 50})
                markets = markets_result.get("markets", [])
                active_tickers = [m["ticker"] for m in markets if m.get("status") == "active"]

                if active_tickers:
                    self.enabled_events.add(event_ticker)
                    self.event_markets[event_ticker] = active_tickers
                    print(f"🤖 Bot enabled for {event_ticker}: {len(active_tickers)} markets")

                    # Start the loop if not running
                    if not self._running:
                        await self._start_loop()
            except Exception as e:
                print(f"Error enabling bot for {event_ticker}: {e}")
        else:
            self.enabled_events.discard(event_ticker)
            self.event_markets.pop(event_ticker, None)
            # Clear price history for this event's markets
            for ticker in list(self.price_history.keys()):
                if ticker.startswith(event_ticker):
                    del self.price_history[ticker]
            print(f"🛑 Bot disabled for {event_ticker}")

            # Stop loop if no events enabled
            if not self.enabled_events and self._running:
                await self._stop_loop()

    async def _start_loop(self):
        """Start the monitoring loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        print("🤖 Momentum bot loop started")

    async def _stop_loop(self):
        """Stop the monitoring loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        print("🛑 Momentum bot loop stopped")

    async def _run_loop(self):
        """Main bot loop."""
        while self._running and self.enabled_events:
            try:
                await self._check_prices()
            except Exception as e:
                print(f"Bot error: {e}")
            await asyncio.sleep(self.poll_interval)

    async def _check_prices(self):
        """Check prices for all monitored markets."""
        now = time.time()

        for event_ticker in list(self.enabled_events):
            tickers = self.event_markets.get(event_ticker, [])
            for ticker in tickers:
                try:
                    orderbook = await client.request("GET", f"/markets/{ticker}/orderbook", params={"depth": 1})

                    yes_bid = orderbook.get("orderbook", {}).get("yes", [[0, 0]])[0][0] if orderbook.get("orderbook", {}).get("yes") else 0
                    yes_ask = orderbook.get("orderbook", {}).get("no", [[0, 0]])[0][0] if orderbook.get("orderbook", {}).get("no") else 100
                    yes_ask = 100 - yes_ask if yes_ask else 100

                    current_price = (yes_bid + yes_ask) // 2 if yes_bid and yes_ask else yes_bid or yes_ask

                    # Initialize price history for this ticker
                    if ticker not in self.price_history:
                        self.price_history[ticker] = []

                    # Add current price to history
                    self.price_history[ticker].append((now, current_price))

                    # Remove old entries (keep last 5 seconds of data)
                    self.price_history[ticker] = [
                        (ts, p) for ts, p in self.price_history[ticker]
                        if now - ts <= 5.0
                    ]

                    # Find price from ~1 second ago
                    target_time = now - self.lookback_seconds
                    old_price = None
                    for ts, p in self.price_history[ticker]:
                        if ts <= target_time:
                            old_price = p
                        else:
                            break

                    # Compare to price from 1 second ago
                    if old_price is not None:
                        price_change = current_price - old_price

                        if abs(price_change) >= self.min_price_move:
                            await self._execute_trade(ticker, event_ticker, price_change, orderbook)
                            # Clear history after trade to avoid repeat triggers
                            self.price_history[ticker] = [(now, current_price)]

                except Exception as e:
                    print(f"Error checking {ticker}: {e}")

    async def _execute_trade(self, ticker: str, event_ticker: str, price_change: int, orderbook: dict):
        """Execute a momentum trade. Bid+1 as IOC order."""
        if price_change > 0:
            # Price went UP - buy YES at highest YES bid + 1
            side = "yes"
            yes_levels = orderbook.get("orderbook", {}).get("yes", [])
            if yes_levels:
                highest_bid = max(level[0] for level in yes_levels)
                order_price = highest_bid + 1
            else:
                return
        else:
            # Price went DOWN - buy NO at highest NO bid + 1
            side = "no"
            no_levels = orderbook.get("orderbook", {}).get("no", [])
            if no_levels:
                highest_bid = max(level[0] for level in no_levels)
                order_price = highest_bid + 1
            else:
                return

        trade = BotTrade(
            timestamp=datetime.now().isoformat(),
            ticker=ticker,
            event_ticker=event_ticker,
            side=side,
            price=order_price,
            count=self.max_shares,
            trigger_price_change=price_change
        )

        try:
            order_data = {
                "ticker": ticker,
                "side": side,
                "action": "buy",
                "count": self.max_shares,
                "type": "limit",
            }
            if side == "yes":
                order_data["yes_price"] = order_price
            else:
                order_data["no_price"] = order_price

            result = await client.request("POST", "/portfolio/orders", json_data=order_data)
            trade.order_id = result.get("order", {}).get("order_id")
            trade.status = "filled" if result.get("order", {}).get("status") == "executed" else "placed"
            print(f"🤖 BOT TRADE: {side.upper()} {self.max_shares}x {ticker} @ {order_price}¢ ({price_change:+d}¢ move)")
        except Exception as e:
            trade.status = "failed"
            print(f"❌ Bot trade failed: {e}")

        self.trades.append(trade)
        if len(self.trades) > 100:
            self.trades = self.trades[-100:]


# Global bot instance
momentum_bot = MomentumBot()


class EventBotToggle(BaseModel):
    event_ticker: str
    enabled: bool


@app.post("/api/bot/toggle")
async def toggle_bot_for_event(toggle: EventBotToggle):
    """Enable or disable the bot for a specific game/event."""
    try:
        await momentum_bot.toggle_event(toggle.event_ticker, toggle.enabled)
        return {
            "status": "enabled" if toggle.enabled else "disabled",
            "event_ticker": toggle.event_ticker,
            "enabled_events": list(momentum_bot.enabled_events),
            "total_enabled": len(momentum_bot.enabled_events)
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/bot/status")
async def get_bot_status():
    """Get the current bot status and recent trades."""
    return {
        "running": momentum_bot._running,
        "enabled_events": list(momentum_bot.enabled_events),
        "total_enabled": len(momentum_bot.enabled_events),
        "config": {
            "min_price_move": momentum_bot.min_price_move,
            "max_shares": momentum_bot.max_shares,
            "poll_interval": momentum_bot.poll_interval
        },
        "recent_trades": [
            {
                "timestamp": t.timestamp,
                "ticker": t.ticker,
                "event_ticker": t.event_ticker,
                "side": t.side,
                "price": t.price,
                "count": t.count,
                "trigger": t.trigger_price_change,
                "status": t.status
            }
            for t in momentum_bot.trades[-20:]
        ],
        "total_trades": len(momentum_bot.trades)
    }

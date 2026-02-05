import asyncio
from typing import Optional
from dataclasses import dataclass, field
from kalshi_client import get_kalshi_client


@dataclass
class OrderBookLevel:
    price: int  # In cents
    quantity: int


@dataclass
class OrderBook:
    ticker: str
    bids: list[OrderBookLevel] = field(default_factory=list)
    asks: list[OrderBookLevel] = field(default_factory=list)

    @property
    def best_bid(self) -> Optional[int]:
        return self.bids[0].price if self.bids else None

    @property
    def best_ask(self) -> Optional[int]:
        return self.asks[0].price if self.asks else None


class OrderBookManager:
    def __init__(self):
        self._books: dict[str, OrderBook] = {}
        self._subscribed_tickers: set[str] = set()
        self._running = False
        self._ws_task: Optional[asyncio.Task] = None

    def get_book(self, ticker: str) -> Optional[OrderBook]:
        return self._books.get(ticker)

    def get_best_ask(self, ticker: str) -> Optional[int]:
        book = self._books.get(ticker)
        return book.best_ask if book else None

    def get_best_bid(self, ticker: str) -> Optional[int]:
        book = self._books.get(ticker)
        return book.best_bid if book else None

    def get_asks(self, ticker: str) -> list[OrderBookLevel]:
        """Get all ask levels sorted by price ascending (best first)."""
        book = self._books.get(ticker)
        if not book:
            return []
        # Sort asks ascending (lowest/best price first)
        sorted_asks = sorted(book.asks, key=lambda x: x.price)
        return sorted_asks

    def get_available_contracts(self, ticker: str, limit_price: int) -> int:
        """Get total contracts available at or below the limit price."""
        asks = self.get_asks(ticker)
        total = 0
        for level in asks:
            if level.price <= limit_price:
                total += level.quantity
            else:
                break  # Asks are sorted, no need to continue
        return total

    async def subscribe(self, ticker: str):
        if ticker not in self._subscribed_tickers:
            self._subscribed_tickers.add(ticker)
            self._books[ticker] = OrderBook(ticker=ticker)

            # Fetch initial orderbook via REST
            client = get_kalshi_client()
            try:
                data = await client.get_orderbook(ticker)
                self._update_book_from_snapshot(ticker, data)
            except Exception as e:
                print(f"Failed to fetch orderbook for {ticker}: {e}")

    def _update_book_from_snapshot(self, ticker: str, data: dict):
        book = self._books.get(ticker)
        if not book:
            return

        # Parse yes side (what we care about for buying YES contracts)
        book.bids = [
            OrderBookLevel(price=level[0], quantity=level[1])
            for level in data.get("yes", {}).get("bids", [])
        ]
        book.asks = [
            OrderBookLevel(price=level[0], quantity=level[1])
            for level in data.get("yes", {}).get("asks", [])
        ]

    def _update_book_from_delta(self, ticker: str, data: dict):
        book = self._books.get(ticker)
        if not book:
            return

        # Handle delta updates
        if "yes" in data:
            if "bids" in data["yes"]:
                self._apply_delta(book.bids, data["yes"]["bids"])
            if "asks" in data["yes"]:
                self._apply_delta(book.asks, data["yes"]["asks"])

    def _apply_delta(self, levels: list[OrderBookLevel], deltas: list):
        for price, qty in deltas:
            # Find existing level
            existing = next((l for l in levels if l.price == price), None)
            if qty == 0:
                if existing:
                    levels.remove(existing)
            elif existing:
                existing.quantity = qty
            else:
                levels.append(OrderBookLevel(price=price, quantity=qty))

        # Keep sorted (bids descending, asks ascending handled by caller)
        levels.sort(key=lambda x: x.price, reverse=True)

    async def _handle_ws_message(self, data: dict):
        msg_type = data.get("type")

        if msg_type == "orderbook_snapshot":
            ticker = data.get("market_ticker")
            if ticker:
                self._update_book_from_snapshot(ticker, data.get("orderbook", {}))

        elif msg_type == "orderbook_delta":
            ticker = data.get("market_ticker")
            if ticker:
                self._update_book_from_delta(ticker, data)

    async def start_websocket(self):
        if self._running:
            return

        self._running = True
        client = get_kalshi_client()

        async def run_ws():
            while self._running:
                try:
                    await client.connect_websocket(self._handle_ws_message)
                except Exception as e:
                    print(f"WebSocket error: {e}")
                    await asyncio.sleep(5)  # Reconnect after delay

        self._ws_task = asyncio.create_task(run_ws())

        # Subscribe to all tickers
        await asyncio.sleep(1)  # Wait for connection
        if self._subscribed_tickers:
            await client.subscribe(
                ["orderbook_delta"],
                list(self._subscribed_tickers)
            )

    async def stop(self):
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()


# Singleton
_manager: Optional[OrderBookManager] = None


def get_orderbook_manager() -> OrderBookManager:
    global _manager
    if _manager is None:
        _manager = OrderBookManager()
    return _manager

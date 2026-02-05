import random
from fastapi import APIRouter, HTTPException
from models import (
    GameConfig, GameSide, CreateGameRequest, UpdateGameRequest,
    OrderResponse, GameWithPrices, BetRequest, OrderBookLevel
)
from kalshi_client import get_kalshi_client
from orderbook import get_orderbook_manager
from config import get_settings

router = APIRouter()

# In-memory game storage (replace with DB for production)
_games: dict[str, GameConfig] = {}


def _generate_mock_asks(base_price: int) -> list[OrderBookLevel]:
    """Generate realistic-looking mock orderbook asks."""
    asks = []
    price = base_price
    for _ in range(10):
        asks.append(OrderBookLevel(price=price, quantity=random.randint(5, 150)))
        price += random.randint(1, 3)
    return asks


@router.post("/games", response_model=GameConfig)
async def create_game(request: CreateGameRequest):
    game = GameConfig.create(
        name=request.name,
        side_a=request.side_a,
        side_b=request.side_b
    )
    _games[game.id] = game

    # Subscribe to orderbook updates for both tickers
    manager = get_orderbook_manager()
    await manager.subscribe(request.side_a.ticker)
    await manager.subscribe(request.side_b.ticker)

    return game


async def _fetch_market_data(ticker: str) -> dict:
    """Fetch market and orderbook data from Kalshi API.

    Returns dict with:
      - yes_asks: list of OrderBookLevel for buying Yes
      - yes_ask: best Yes ask price
      - yes_bid: best Yes bid price
      - no_asks: list of OrderBookLevel for buying No
      - no_ask: best No ask price (100 - yes_bid)
    """
    client = get_kalshi_client()
    try:
        # Get market data (has best bid/ask)
        market_response = await client.get_market(ticker)
        market = market_response.get("market", market_response)

        best_yes_ask = market.get("yes_ask")  # Already in cents
        best_yes_bid = market.get("yes_bid")  # Already in cents

        # No ask = 100 - Yes bid
        best_no_ask = (100 - best_yes_bid) if best_yes_bid else None

        # Get orderbook for depth
        orderbook = await client.get_orderbook(ticker)
        orderbook_data = orderbook.get("orderbook", {})

        # To BUY Yes, we look at No bids and convert: yes_ask = 100 - no_bid
        no_bids_raw = orderbook_data.get("no") or []  # Handle null
        yes_asks = []
        for level in no_bids_raw:
            if len(level) >= 2:
                no_price, qty = level[0], level[1]
                yes_ask_price = 100 - no_price  # Convert No bid to Yes ask
                yes_asks.append(OrderBookLevel(price=yes_ask_price, quantity=qty))
        yes_asks.sort(key=lambda x: x.price)  # Ascending (best ask first)

        # To BUY No, we look at Yes bids and convert: no_ask = 100 - yes_bid
        yes_bids_raw = orderbook_data.get("yes") or []  # Handle null
        no_asks = []
        for level in yes_bids_raw:
            if len(level) >= 2:
                yes_price, qty = level[0], level[1]
                no_ask_price = 100 - yes_price  # Convert Yes bid to No ask
                no_asks.append(OrderBookLevel(price=no_ask_price, quantity=qty))
        no_asks.sort(key=lambda x: x.price)  # Ascending (best ask first)

        return {
            "yes_asks": yes_asks,
            "yes_ask": best_yes_ask,
            "yes_bid": best_yes_bid,
            "no_asks": no_asks,
            "no_ask": best_no_ask,
        }
    except Exception as e:
        print(f"Error fetching market data for {ticker}: {e}")
        return {
            "yes_asks": [],
            "yes_ask": None,
            "yes_bid": None,
            "no_asks": [],
            "no_ask": None,
        }


@router.get("/games", response_model=list[GameWithPrices])
async def list_games():
    settings = get_settings()
    result = []

    for game in _games.values():
        if settings.demo_mode:
            # Generate mock orderbook data
            side_a_base = random.randint(35, 65)
            side_b_base = random.randint(35, 65)
            side_a_asks = _generate_mock_asks(side_a_base)
            side_b_asks = _generate_mock_asks(side_b_base)
            # No asks = 100 - yes_bid, so generate based on complement
            side_a_no_asks = _generate_mock_asks(100 - side_a_base + random.randint(1, 5))
            side_b_no_asks = _generate_mock_asks(100 - side_b_base + random.randint(1, 5))

            result.append(GameWithPrices(
                game=game,
                side_a_ask=side_a_asks[0].price if side_a_asks else None,
                side_a_bid=side_a_base - random.randint(1, 3),
                side_b_ask=side_b_asks[0].price if side_b_asks else None,
                side_b_bid=side_b_base - random.randint(1, 3),
                side_a_asks=side_a_asks,
                side_b_asks=side_b_asks,
                # Each team's own No market
                side_a_no_ask=side_a_no_asks[0].price if side_a_no_asks else None,
                side_a_no_asks=side_a_no_asks,
                side_b_no_ask=side_b_no_asks[0].price if side_b_no_asks else None,
                side_b_no_asks=side_b_no_asks,
            ))
        else:
            # Fetch orderbook data directly from Kalshi API
            side_a_data = await _fetch_market_data(game.side_a.ticker)
            side_b_data = await _fetch_market_data(game.side_b.ticker)

            # Each team shows its OWN Yes and No markets directly
            result.append(GameWithPrices(
                game=game,
                side_a_ask=side_a_data["yes_ask"],
                side_a_bid=side_a_data["yes_bid"],
                side_b_ask=side_b_data["yes_ask"],
                side_b_bid=side_b_data["yes_bid"],
                side_a_asks=side_a_data["yes_asks"],
                side_b_asks=side_b_data["yes_asks"],
                # Team A's own No market
                side_a_no_ask=side_a_data["no_ask"],
                side_a_no_asks=side_a_data["no_asks"],
                # Team B's own No market
                side_b_no_ask=side_b_data["no_ask"],
                side_b_no_asks=side_b_data["no_asks"],
            ))

    return result


@router.get("/games/{game_id}", response_model=GameWithPrices)
async def get_game(game_id: str):
    if game_id not in _games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = _games[game_id]
    settings = get_settings()

    if settings.demo_mode:
        side_a_base = random.randint(35, 65)
        side_b_base = random.randint(35, 65)
        side_a_asks = _generate_mock_asks(side_a_base)
        side_b_asks = _generate_mock_asks(side_b_base)
        # No asks = 100 - yes_bid, so generate based on complement
        side_a_no_asks = _generate_mock_asks(100 - side_a_base + random.randint(1, 5))
        side_b_no_asks = _generate_mock_asks(100 - side_b_base + random.randint(1, 5))

        return GameWithPrices(
            game=game,
            side_a_ask=side_a_asks[0].price if side_a_asks else None,
            side_a_bid=side_a_base - random.randint(1, 3),
            side_b_ask=side_b_asks[0].price if side_b_asks else None,
            side_b_bid=side_b_base - random.randint(1, 3),
            side_a_asks=side_a_asks,
            side_b_asks=side_b_asks,
            # Each team's own No market
            side_a_no_ask=side_a_no_asks[0].price if side_a_no_asks else None,
            side_a_no_asks=side_a_no_asks,
            side_b_no_ask=side_b_no_asks[0].price if side_b_no_asks else None,
            side_b_no_asks=side_b_no_asks,
        )
    else:
        # Fetch orderbook data directly from Kalshi API
        side_a_data = await _fetch_market_data(game.side_a.ticker)
        side_b_data = await _fetch_market_data(game.side_b.ticker)

        # Each team shows its OWN Yes and No markets directly
        return GameWithPrices(
            game=game,
            side_a_ask=side_a_data["yes_ask"],
            side_a_bid=side_a_data["yes_bid"],
            side_b_ask=side_b_data["yes_ask"],
            side_b_bid=side_b_data["yes_bid"],
            side_a_asks=side_a_data["yes_asks"],
            side_b_asks=side_b_data["yes_asks"],
            # Team A's own No market
            side_a_no_ask=side_a_data["no_ask"],
            side_a_no_asks=side_a_data["no_asks"],
            # Team B's own No market
            side_b_no_ask=side_b_data["no_ask"],
            side_b_no_asks=side_b_data["no_asks"],
        )


@router.put("/games/{game_id}", response_model=GameConfig)
async def update_game(game_id: str, request: UpdateGameRequest):
    if game_id not in _games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = _games[game_id]

    if request.name:
        game.name = request.name
    if request.side_a:
        game.side_a = request.side_a
        manager = get_orderbook_manager()
        await manager.subscribe(request.side_a.ticker)
    if request.side_b:
        game.side_b = request.side_b
        manager = get_orderbook_manager()
        await manager.subscribe(request.side_b.ticker)

    return game


@router.delete("/games/{game_id}")
async def delete_game(game_id: str):
    if game_id not in _games:
        raise HTTPException(status_code=404, detail="Game not found")

    del _games[game_id]
    return {"status": "deleted"}


@router.post("/games/{game_id}/bet/{side}", response_model=OrderResponse)
async def place_bet(game_id: str, side: str, request: BetRequest = None):
    """
    Execute a bet on side 'a' or 'b'.
    bet_type can be 'yes' or 'no' (defaults to 'yes').
    """
    if game_id not in _games:
        raise HTTPException(status_code=404, detail="Game not found")

    if side not in ("a", "b"):
        raise HTTPException(status_code=400, detail="Side must be 'a' or 'b'")

    game = _games[game_id]
    game_side: GameSide = game.side_a if side == "a" else game.side_b

    # Use request params if provided, otherwise use preset
    contracts = request.contracts if request and request.contracts else game_side.size
    limit_price = request.limit_price if request and request.limit_price else int(game_side.price_limit)
    bet_type = request.bet_type if request and request.bet_type else "yes"

    if bet_type not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="bet_type must be 'yes' or 'no'")

    settings = get_settings()

    if settings.demo_mode:
        # Return mock order response
        import uuid
        return OrderResponse(
            order_id=str(uuid.uuid4())[:8],
            ticker=game_side.ticker,
            side=bet_type,
            size=contracts,
            price=float(limit_price),
            status="filled"
        )

    client = get_kalshi_client()

    try:
        result = await client.place_order(
            ticker=game_side.ticker,
            side=bet_type,
            action="buy",
            count=contracts,
            price=limit_price,
            order_type="limit"
        )

        return OrderResponse(
            order_id=result.get("order", {}).get("order_id", "unknown"),
            ticker=game_side.ticker,
            side=bet_type,
            size=contracts,
            price=float(limit_price),
            status=result.get("order", {}).get("status", "unknown")
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/markets/search")
async def search_markets(query: str):
    """Search for markets matching a query."""
    client = get_kalshi_client()
    try:
        result = await client.search_markets(query)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug/market/{ticker}")
async def debug_market(ticker: str):
    """Debug endpoint - returns raw market data from Kalshi."""
    settings = get_settings()
    if settings.demo_mode:
        return {"error": "Debug only works with real API"}

    client = get_kalshi_client()
    try:
        market = await client.get_market(ticker)
        return {"raw_market": market}
    except Exception as e:
        return {"error": str(e)}


@router.get("/debug/orderbook/{ticker}")
async def debug_orderbook(ticker: str):
    """Debug endpoint - returns raw orderbook data from Kalshi."""
    settings = get_settings()
    if settings.demo_mode:
        return {"error": "Debug only works with real API"}

    client = get_kalshi_client()
    try:
        orderbook = await client.get_orderbook(ticker)
        return {"raw_orderbook": orderbook}
    except Exception as e:
        return {"error": str(e)}


@router.get("/markets/{ticker}/related")
async def get_related_market(ticker: str):
    """
    Given a ticker, find the related opposing market.
    Returns both sides with team names auto-populated.
    """
    settings = get_settings()

    if settings.demo_mode:
        # Generate mock related market based on ticker
        ticker_upper = ticker.upper()

        # Mock team names based on common patterns
        mock_teams = [
            ("Lakers", "Celtics"),
            ("Warriors", "Heat"),
            ("Knicks", "Bulls"),
            ("Nets", "Suns"),
            ("Chiefs", "Eagles"),
            ("Cowboys", "49ers"),
        ]
        team_a, team_b = random.choice(mock_teams)

        return {
            "event_name": f"{team_a} vs {team_b}",
            "side_a": {
                "ticker": ticker_upper,
                "team_name": team_a,
            },
            "side_b": {
                "ticker": f"{ticker_upper}-OPP",
                "team_name": team_b,
            }
        }

    client = get_kalshi_client()
    try:
        ticker_upper = ticker.upper()

        # First, try to get markets for this as an event ticker
        event_response = await client.get_event_markets(ticker_upper)
        markets = event_response.get("markets", [])

        if len(markets) >= 2:
            # Found multiple markets - this was an event ticker
            # Sort by ticker to get consistent ordering
            markets.sort(key=lambda m: m.get("ticker", ""))
            market_a = markets[0]
            market_b = markets[1]

            return {
                "event_name": market_a.get("title", ticker_upper),
                "side_a": {
                    "ticker": market_a.get("ticker"),
                    "team_name": market_a.get("yes_sub_title") or market_a.get("subtitle") or "Team A",
                },
                "side_b": {
                    "ticker": market_b.get("ticker"),
                    "team_name": market_b.get("yes_sub_title") or market_b.get("subtitle") or "Team B",
                }
            }

        # Try as a market ticker instead
        response = await client.get_market(ticker_upper)
        market = response.get("market", response)
        event_ticker = market.get("event_ticker", "")
        yes_sub_title = market.get("yes_sub_title", "")

        # Get other markets in the same event
        if event_ticker:
            event_response = await client.get_event_markets(event_ticker)
            markets = event_response.get("markets", [])
            other_markets = [m for m in markets if m.get("ticker") != ticker_upper]

            if other_markets:
                other = other_markets[0]
                return {
                    "event_name": market.get("title", event_ticker),
                    "side_a": {
                        "ticker": ticker_upper,
                        "team_name": yes_sub_title or "Team A",
                    },
                    "side_b": {
                        "ticker": other.get("ticker"),
                        "team_name": other.get("yes_sub_title") or "Team B",
                    }
                }

        # Fallback: single market
        return {
            "event_name": market.get("title", ticker_upper),
            "side_a": {
                "ticker": ticker_upper,
                "team_name": yes_sub_title or "Yes",
            },
            "side_b": None
        }

    except Exception as e:
        print(f"Error in get_related_market: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/events")
async def get_events(
    category: str = None,
    search: str = None,
    limit: int = 50,
    series_ticker: str = None
):
    """Get events from Kalshi API."""
    client = get_kalshi_client()
    try:
        params = f"limit={limit}"
        if series_ticker:
            params += f"&series_ticker={series_ticker}"

        result = await client._request("GET", f"/events?{params}")
        events = result.get("events", [])

        # Filter by category if specified
        if category:
            events = [e for e in events if e.get("category", "").lower() == category.lower()]

        # Filter by search if specified
        if search:
            search_lower = search.lower()
            events = [e for e in events if search_lower in e.get("title", "").lower()]

        # For each event, get its markets
        enriched_events = []
        for event in events[:limit]:
            event_ticker = event.get("event_ticker", "")
            try:
                markets_result = await client._request("GET", f"/markets?event_ticker={event_ticker}")
                event["markets"] = markets_result.get("markets", [])
            except:
                event["markets"] = []

            # Include event_ticker in the response
            event["ticker"] = event_ticker
            enriched_events.append(event)

        return {"events": enriched_events}
    except Exception as e:
        print(f"Error fetching events: {e}")
        return {"events": [], "error": str(e)}


@router.get("/positions")
async def get_positions():
    client = get_kalshi_client()
    return await client.get_positions()


@router.get("/balance")
async def get_balance():
    client = get_kalshi_client()
    return await client.get_balance()


@router.delete("/order/{order_id}")
async def cancel_order(order_id: str):
    client = get_kalshi_client()
    return await client.cancel_order(order_id)

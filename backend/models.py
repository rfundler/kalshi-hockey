from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import uuid


class GameSide(BaseModel):
    ticker: str
    team_name: str
    size: int
    price_limit: float  # In cents (e.g., 55 for 55¢)


class GameConfig(BaseModel):
    id: str
    name: str
    side_a: GameSide
    side_b: GameSide
    created_at: datetime

    @classmethod
    def create(cls, name: str, side_a: GameSide, side_b: GameSide) -> "GameConfig":
        return cls(
            id=str(uuid.uuid4())[:8],
            name=name,
            side_a=side_a,
            side_b=side_b,
            created_at=datetime.utcnow()
        )


class CreateGameRequest(BaseModel):
    name: str
    side_a: GameSide
    side_b: GameSide


class UpdateGameRequest(BaseModel):
    name: Optional[str] = None
    side_a: Optional[GameSide] = None
    side_b: Optional[GameSide] = None


class OrderResponse(BaseModel):
    order_id: str
    ticker: str
    side: str
    size: int
    price: float
    status: str


class Position(BaseModel):
    ticker: str
    position: int  # Positive = long, negative = short
    avg_price: float
    market_price: float
    pnl: float


class OrderBookLevel(BaseModel):
    price: int  # In cents
    quantity: int


class GameWithPrices(BaseModel):
    game: GameConfig
    side_a_ask: Optional[float]  # Yes ask
    side_b_ask: Optional[float]  # Yes ask
    side_a_bid: Optional[float]  # Yes bid
    side_b_bid: Optional[float]  # Yes bid
    side_a_asks: list[OrderBookLevel] = []  # Yes ask depth
    side_b_asks: list[OrderBookLevel] = []  # Yes ask depth
    side_a_no_ask: Optional[float] = None  # No ask (100 - yes_bid)
    side_b_no_ask: Optional[float] = None  # No ask (100 - yes_bid)
    side_a_no_asks: list[OrderBookLevel] = []  # No ask depth
    side_b_no_asks: list[OrderBookLevel] = []  # No ask depth


class BetRequest(BaseModel):
    contracts: Optional[int] = None
    limit_price: Optional[int] = None
    bet_type: Optional[str] = "yes"  # "yes" or "no"

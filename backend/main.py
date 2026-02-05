from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from api import router
from orderbook import get_orderbook_manager
from config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    if settings.demo_mode:
        print("🎮 Running in DEMO MODE - no real API connections")
        print("📱 Open http://localhost:8000 in your browser")
        yield
    else:
        # Startup: Initialize WebSocket connection
        print("🔌 Connecting to Kalshi API...")
        manager = get_orderbook_manager()
        await manager.start_websocket()
        yield
        # Shutdown: Clean up
        await manager.stop()


app = FastAPI(
    title="Kalshi Fast Trader",
    description="Fast trade execution for Kalshi prediction markets",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(router)

# Static files
static_path = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_path), name="static")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return FileResponse(static_path / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

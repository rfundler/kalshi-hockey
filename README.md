# Kalshi Trader

Visual trading dashboard for Kalshi prediction markets.

## Features

- Event selector with all available events
- Grid view of markets (4 columns, scrollable)
- Real-time orderbook display for each market
- Buy/Sell buttons with price and quantity inputs
- Balance and positions display
- Auto-refresh orderbooks every 5 seconds

## Deploy to Railway

### 1. Backend

1. Go to Railway.app and create a new project
2. Click "New Service" → "GitHub Repo" or "Empty Service"
3. If empty service, connect your repo or use Docker
4. Set root directory to `backend`
5. Add environment variables:
   - `API_KEY_ID` = your Kalshi API key ID
   - `PRIVATE_KEY_PEM` = your full private key (with \n for newlines)

### 2. Frontend

1. In same Railway project, add another service
2. Set root directory to `frontend`
3. Add build argument:
   - `NEXT_PUBLIC_API_URL` = your backend Railway URL (e.g., https://backend-xxx.railway.app)

## Local Development

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Create .env with API_KEY_ID and PRIVATE_KEY_PEM
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Environment Variables

### Backend
- `API_KEY_ID` - Kalshi API key ID
- `PRIVATE_KEY_PEM` - RSA private key (PEM format)

### Frontend
- `NEXT_PUBLIC_API_URL` - Backend API URL

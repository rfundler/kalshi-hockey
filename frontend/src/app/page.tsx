'use client'

import { useState, useEffect, useRef } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Market {
  ticker: string
  title: string
  yes_sub_title?: string
  last_price?: number
  volume?: number
}

interface Event {
  ticker: string
  event_ticker?: string
  title: string
  sub_title?: string
  category: string
  type?: string
  markets: Market[]
}

// Parse date from event ticker like "KXNBAMENTION-26FEB03PHXPOR" -> "Feb 3"
const parseEventDate = (ticker: string): string | null => {
  // Match patterns like 26FEB03, 26JAN31, etc.
  const match = ticker.match(/(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/i)
  if (!match) return null

  const [, year, month, day] = match
  const monthNames: Record<string, string> = {
    JAN: 'Jan', FEB: 'Feb', MAR: 'Mar', APR: 'Apr', MAY: 'May', JUN: 'Jun',
    JUL: 'Jul', AUG: 'Aug', SEP: 'Sep', OCT: 'Oct', NOV: 'Nov', DEC: 'Dec'
  }

  const dayNum = parseInt(day, 10)
  return `${monthNames[month.toUpperCase()]} ${dayNum}`
}

// Check if event is today or in the past
const getEventStatus = (ticker: string): 'upcoming' | 'today' | 'live' | 'past' => {
  const match = ticker.match(/(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/i)
  if (!match) return 'upcoming'

  const [, year, month, day] = match
  const monthIndex: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  }

  const eventDate = new Date(2000 + parseInt(year), monthIndex[month.toUpperCase()], parseInt(day))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  eventDate.setHours(0, 0, 0, 0)

  const diff = eventDate.getTime() - today.getTime()
  if (diff < 0) return 'past'
  if (diff === 0) return 'today'
  return 'upcoming'
}

interface Position {
  ticker: string
  position: number
  market_title?: string
  yes_sub_title?: string
  market_exposure?: number
  realized_pnl?: number
  total_traded?: number
  resting_orders_count?: number
}

interface Order {
  order_id: string
  ticker: string
  side: string
  action: string
  type: string
  status: string
  yes_price?: number
  no_price?: number
  remaining_count: number
  created_time: string
}

type OrderbookLevel = [number, number]

interface Orderbook {
  yes: OrderbookLevel[]
  no: OrderbookLevel[]
}

interface HistoryPoint {
  ts: number
  yes_price: number
  yes_bid: number
  yes_ask: number
  volume: number
  open_interest: number
}

interface Trade {
  trade_id: string
  ticker: string
  yes_price: number
  count: number
  taker_side: string
  created_time: string
}

export default function TradingDashboard() {
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [orderbooks, setOrderbooks] = useState<Record<string, Orderbook>>({})
  const [balance, setBalance] = useState<number | null>(null)
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [orderInputs, setOrderInputs] = useState<Record<string, { price: string; qty: string }>>({})
  const [orders, setOrders] = useState<Order[]>([])
  const [showPositions, setShowPositions] = useState(true)
  const [maxBetMode, setMaxBetMode] = useState<'yes' | 'no' | 'off'>('off')
  const [selectedStrike, setSelectedStrike] = useState<Market | null>(null)
  const [strikeHistory, setStrikeHistory] = useState<HistoryPoint[]>([])
  const [strikeTrades, setStrikeTrades] = useState<Trade[]>([])
  const [historyPeriod, setHistoryPeriod] = useState<number>(60) // minutes
  const [strikeOrderbook, setStrikeOrderbook] = useState<Orderbook | null>(null)
  const [pennyBotStrikes, setPennyBotStrikes] = useState<Record<string, 'yes' | 'no' | 'both' | 'off'>>({})
  const [pennyBotLog, setPennyBotLog] = useState<string[]>([])
  const [pennyBotLastPrice, setPennyBotLastPrice] = useState<Record<string, number>>({})

  // Momentum Bot state
  const [botEnabledEvents, setBotEnabledEvents] = useState<Set<string>>(new Set())
  const [botStatus, setBotStatus] = useState<{
    running: boolean
    enabled_events: string[]
    total_enabled: number
    config: { min_price_move: number; max_shares: number; poll_interval: number }
    recent_trades: Array<{
      timestamp: string
      ticker: string
      event_ticker: string
      side: string
      price: number
      count: number
      trigger: number
      status: string
    }>
    total_trades: number
  } | null>(null)

  // Fetch balance
  const fetchBalance = async () => {
    try {
      const res = await fetch(`${API}/api/balance`)
      const data = await res.json()
      if (!data.error) {
        setBalance(data.balance)
        setPortfolioValue(data.portfolio_value)
      }
    } catch (e) {}
  }

  // Fetch positions
  const fetchPositions = async () => {
    try {
      const res = await fetch(`${API}/api/positions`)
      const data = await res.json()
      setPositions(data.market_positions || [])
    } catch (e) {}
  }

  // Fetch resting orders
  const fetchOrders = async () => {
    try {
      const res = await fetch(`${API}/api/orders?status=resting`)
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (e) {}
  }

  // Cancel order
  const cancelOrder = async (orderId: string) => {
    try {
      await fetch(`${API}/api/orders/${orderId}`, { method: 'DELETE' })
      fetchOrders()
      fetchBalance()
    } catch (e) {}
  }

  // Momentum Bot functions
  const fetchBotStatus = async () => {
    try {
      const res = await fetch(`${API}/api/bot/status`)
      const data = await res.json()
      setBotStatus(data)
      setBotEnabledEvents(new Set(data.enabled_events || []))
    } catch (e) {}
  }

  const toggleBotForEvent = async (eventTicker: string) => {
    const isEnabled = botEnabledEvents.has(eventTicker)
    try {
      const res = await fetch(`${API}/api/bot/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_ticker: eventTicker, enabled: !isEnabled })
      })
      const data = await res.json()
      setBotEnabledEvents(new Set(data.enabled_events || []))
      fetchBotStatus()
    } catch (e) {}
  }

  // Max bet - buy all available at weighted average price
  const maxBet = async (ticker: string, side: 'yes' | 'no') => {
    const ob = orderbooks[ticker]
    if (!ob) return

    // For buying YES, we take from NO bids (100 - no_price = yes_ask)
    // For buying NO, we take from YES bids (100 - yes_price = no_ask)
    const levels = side === 'yes' ? ob.no : ob.yes
    if (!levels || levels.length === 0) {
      alert('No liquidity available')
      return
    }

    // Calculate total qty and weighted average price
    const totalQty = levels.reduce((sum, [_, qty]) => sum + qty, 0)

    try {
      const body = {
        ticker,
        side,
        action: 'buy',
        count: totalQty,
        type: 'market',
      }

      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.order) {
        alert('Max bet placed!')
        fetchBalance()
        fetchPositions()
        fetchOrderbook(ticker)
      } else {
        alert('Error: ' + JSON.stringify(data))
      }
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  // Fetch strike detail data
  const openStrikeDetail = async (market: Market) => {
    setSelectedStrike(market)
    fetchStrikeData(market.ticker, historyPeriod)
  }

  const fetchStrikeData = async (ticker: string, period: number) => {
    // Fetch full orderbook
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/orderbook?depth=50`)
      const data = await res.json()
      setStrikeOrderbook(data.orderbook)
    } catch (e) {}

    // Fetch history
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/history?period_interval=${period}`)
      const data = await res.json()
      setStrikeHistory(data.history || [])
    } catch (e) {
      setStrikeHistory([])
    }

    // Fetch recent trades
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/trades?limit=50`)
      const data = await res.json()
      setStrikeTrades(data.trades || [])
    } catch (e) {
      setStrikeTrades([])
    }
  }

  // Change history period
  const changeHistoryPeriod = (period: number) => {
    setHistoryPeriod(period)
    if (selectedStrike) {
      fetchStrikeData(selectedStrike.ticker, period)
    }
  }

  // Parse date from ticker for sorting
  const getEventDateValue = (ticker: string): number => {
    const match = ticker.match(/(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/i)
    if (!match) return 0

    const [, year, month, day] = match
    const monthIndex: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    }

    return new Date(2000 + parseInt(year), monthIndex[month.toUpperCase()], parseInt(day)).getTime()
  }

  // Fetch NHL Games
  const fetchEvents = async (search?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('series_ticker', 'KXNHLGAME')
      params.append('limit', '50')
      if (search) params.append('search', search)

      const res = await fetch(`${API}/api/events?${params}`)
      const data = await res.json()

      // Sort events by date (earliest first)
      const sortedEvents = (data.events || []).sort((a: Event, b: Event) => {
        const dateA = getEventDateValue(a.event_ticker || a.ticker)
        const dateB = getEventDateValue(b.event_ticker || b.ticker)
        return dateA - dateB
      })

      setEvents(sortedEvents)
    } catch (e) {
      console.error('Failed to fetch events:', e)
    }
    setLoading(false)
  }

  // Fetch orderbook
  const fetchOrderbook = async (ticker: string) => {
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/orderbook`)
      const data = await res.json()
      setOrderbooks(prev => ({ ...prev, [ticker]: data.orderbook }))
    } catch (e) {}
  }

  // Fetch all orderbooks for selected event
  const fetchEventOrderbooks = async (event: Event) => {
    for (const market of event.markets) {
      fetchOrderbook(market.ticker)
    }
  }

  // Place order
  const placeOrder = async (ticker: string, side: 'yes' | 'no', action: 'buy' | 'sell') => {
    const input = orderInputs[ticker]
    if (!input?.qty) {
      alert('Enter quantity')
      return
    }

    try {
      const body: any = {
        ticker,
        side,
        action,
        count: parseInt(input.qty),
        type: input.price ? 'limit' : 'market',
      }
      if (input.price) {
        if (side === 'yes') body.yes_price = parseInt(input.price)
        else body.no_price = parseInt(input.price)
      }

      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.order) {
        alert('Order placed!')
        fetchBalance()
        fetchPositions()
        fetchOrderbook(ticker)
      } else {
        alert('Error: ' + JSON.stringify(data))
      }
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  // Initial load
  useEffect(() => {
    fetchBalance()
    fetchPositions()
    fetchEvents()
    fetchBotStatus()

    const interval = setInterval(() => {
      fetchBalance()
      fetchPositions()
      fetchBotStatus()
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEvents(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // When event selected, fetch orderbooks and orders
  useEffect(() => {
    if (selectedEvent) {
      fetchEventOrderbooks(selectedEvent)
      fetchOrders()
      // Refresh orderbooks and orders periodically
      const interval = setInterval(() => {
        fetchEventOrderbooks(selectedEvent)
        fetchOrders()
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [selectedEvent])

  // Penny bot logic
  const PENNY_BOT_ORDER_SIZE = 50  // Max 50 contracts per order
  const PENNY_BOT_MIN_BID_QTY = 125  // Only penny jump if 125+ contracts at best bid

  const placePennyOrder = async (ticker: string, side: 'yes' | 'no', price: number) => {
    try {
      const body: any = {
        ticker,
        side,
        action: 'buy',
        count: PENNY_BOT_ORDER_SIZE,
        type: 'limit',
      }
      if (side === 'yes') body.yes_price = price
      else body.no_price = price

      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.order) {
        const logMsg = `[${new Date().toLocaleTimeString()}] Placed ${side.toUpperCase()} bid: ${price}¢ x${PENNY_BOT_ORDER_SIZE} on ${ticker}`
        setPennyBotLog(prev => [logMsg, ...prev].slice(0, 50))
        fetchOrders()
        fetchBalance()
      }
    } catch (e) {
      console.error('Penny bot order failed:', e)
    }
  }

  const cancelPennyOrder = async (orderId: string) => {
    try {
      await fetch(`${API}/api/orders/${orderId}`, { method: 'DELETE' })
      fetchOrders()
      fetchBalance()
    } catch (e) {
      console.error('Cancel order failed:', e)
    }
  }

  // Penny bot effect - checks orderbooks and places orders
  // Track pending orders to prevent duplicates
  const pennyBotPending = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedEvent) return

    // Check if any strikes have penny bot enabled
    const activeStrikes = Object.entries(pennyBotStrikes).filter(([_, mode]) => mode !== 'off')
    if (activeStrikes.length === 0) return

    const checkAndPlace = async () => {
      for (const market of selectedEvent.markets) {
        const botMode = pennyBotStrikes[market.ticker]
        if (!botMode || botMode === 'off') continue

        // Skip injury-related strikes (e.g., "injury / injured")
        const title = (market.title || market.yes_sub_title || '').toLowerCase()
        if (title.includes('injury')) continue

        const ob = orderbooks[market.ticker]
        if (!ob) continue

        const sides: ('yes' | 'no')[] = botMode === 'both' ? ['yes', 'no'] : [botMode]

        for (const side of sides) {
          const key = `${market.ticker}-${side}`

          // Skip if we're already processing this strike/side
          if (pennyBotPending.current.has(key)) continue

          // Get bids for this side
          const bids = side === 'yes' ? ob.yes : ob.no
          if (!bids || bids.length === 0) continue

          // Find highest bid and its quantity (excluding our own orders)
          const highestBid = Math.max(...bids.map(([p]) => p))
          const highestBidQty = bids.filter(([p]) => p === highestBid).reduce((sum, [_, q]) => sum + q, 0)

          // Check if we already have a resting order on this strike/side
          const existingOrder = orders.find(
            o => o.ticker === market.ticker && o.side === side
          )

          // Target price is 1 cent above highest bid
          const targetPrice = highestBid + 1

          // Check if parameters are valid: bid < 90, qty at highest bid >= 125
          const paramsValid = highestBid < 90 && highestBidQty >= PENNY_BOT_MIN_BID_QTY

          // If we have an existing order, check if it needs to be cancelled
          if (existingOrder) {
            const ourPrice = side === 'yes' ? existingOrder.yes_price : existingOrder.no_price

            // Cancel if: outbid OR parameters no longer valid
            const outbid = ourPrice && ourPrice < targetPrice
            const shouldCancel = outbid || !paramsValid

            if (shouldCancel) {
              pennyBotPending.current.add(key)
              const reason = !paramsValid ? 'params invalid' : 'outbid'
              const logMsg = `[${new Date().toLocaleTimeString()}] Cancelling ${side.toUpperCase()} @ ${ourPrice}¢ - ${reason} on ${market.ticker}`
              setPennyBotLog(prev => [logMsg, ...prev].slice(0, 50))

              try {
                await cancelPennyOrder(existingOrder.order_id)
                await new Promise(r => setTimeout(r, 500))
              } finally {
                setTimeout(() => pennyBotPending.current.delete(key), 1000)
              }
            }
            continue // Will re-check on next cycle after cancel
          }

          // Don't place new order if params invalid
          if (!paramsValid) continue

          // Check if we already hold >= 50 contracts on this side (max position)
          const position = positions.find(p => p.ticker === market.ticker)
          const heldQty = position?.position || 0
          // position > 0 means YES, position < 0 means NO
          if (side === 'yes' && heldQty >= 50) continue
          if (side === 'no' && heldQty <= -50) continue

          // Check there's no ask that would immediately fill us (spread exists)
          const oppositeAsks = side === 'yes' ? ob.no : ob.yes
          if (oppositeAsks && oppositeAsks.length > 0) {
            const lowestAsk = 100 - Math.max(...oppositeAsks.map(([p]) => p))
            if (targetPrice >= lowestAsk) continue // Would cross the spread
          }

          // Mark as pending and place the order
          pennyBotPending.current.add(key)
          try {
            await placePennyOrder(market.ticker, side, targetPrice)
            setPennyBotLastPrice(prev => ({ ...prev, [`${market.ticker}-${side}`]: targetPrice }))
          } finally {
            setTimeout(() => pennyBotPending.current.delete(key), 2000)
          }
        }
      }
    }

    checkAndPlace()
  }, [pennyBotStrikes, orderbooks, orders, selectedEvent, positions])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Kalshi</h1>
              <span className="bg-cyan-100 text-cyan-800 px-3 py-1 rounded-full text-sm font-medium">
                NHL Hockey
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {/* Momentum Bot Status */}
              {botEnabledEvents.size > 0 && (
                <div className="flex items-center gap-2 border-r pr-4 mr-2">
                  <span className="text-sm font-medium text-yellow-700 bg-yellow-100 px-2 py-1 rounded">
                    🤖 Bot: {botEnabledEvents.size} game{botEnabledEvents.size !== 1 ? 's' : ''}
                  </span>
                  {botStatus && (
                    <span className="text-xs text-gray-500">
                      {botStatus.total_trades} trades
                    </span>
                  )}
                </div>
              )}
              <div className="text-gray-600">
                <span className="font-medium text-gray-900">
                  ${balance !== null ? (balance / 100).toFixed(0) : '---'}
                </span>
                {' '}Cash
              </div>
              <div className="text-gray-600">
                <span className="font-medium text-gray-900">
                  ${portfolioValue !== null ? (portfolioValue / 100).toFixed(0) : '---'}
                </span>
                {' '}Portfolio
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Bot Status Bar */}
      {botStatus && botStatus.recent_trades && botStatus.recent_trades.length > 0 && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-medium text-yellow-800">Recent Bot Trades:</span>
              <div className="flex gap-2 overflow-x-auto">
                {botStatus.recent_trades.slice(-5).reverse().map((trade, i) => (
                  <span
                    key={i}
                    className={`px-2 py-0.5 rounded text-xs font-mono ${
                      trade.side === 'yes' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {trade.side.toUpperCase()} {trade.count}x @ {trade.price}¢ ({trade.trigger > 0 ? '+' : ''}{trade.trigger}¢)
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {selectedEvent ? (
        // Event detail view
        <div className="max-w-5xl mx-auto px-4 py-6">
          <button
            onClick={() => setSelectedEvent(null)}
            className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            ← Back to markets
          </button>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedEvent.title}</h2>

          {/* Max Bet Bar */}
          <div className="bg-gray-100 rounded-lg p-3 mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Quick Max Bet</span>
              <div className="flex items-center gap-1 bg-white rounded-lg p-1 border">
                <button
                  onClick={() => setMaxBetMode('yes')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${maxBetMode === 'yes' ? 'bg-green-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Buy Yes
                </button>
                <button
                  onClick={() => setMaxBetMode('no')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${maxBetMode === 'no' ? 'bg-red-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Buy No
                </button>
                <button
                  onClick={() => setMaxBetMode('off')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${maxBetMode === 'off' ? 'bg-gray-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Off
                </button>
              </div>
            </div>

            {maxBetMode !== 'off' && (
              <div className="grid grid-cols-5 gap-2">
                {selectedEvent.markets.map((market) => {
                  const ob = orderbooks[market.ticker]
                  const levels = maxBetMode === 'yes' ? ob?.no : ob?.yes
                  const totalQty = levels?.reduce((sum, [_, qty]) => sum + qty, 0) || 0

                  // Calculate weighted average price
                  let weightedAvgPrice = null
                  if (levels && levels.length > 0 && totalQty > 0) {
                    const totalCost = levels.reduce((sum, [price, qty]) => {
                      const askPrice = 100 - price // Convert bid to ask price
                      return sum + (askPrice * qty)
                    }, 0)
                    weightedAvgPrice = Math.round(totalCost / totalQty)
                  }

                  return (
                    <button
                      key={market.ticker}
                      onClick={() => maxBet(market.ticker, maxBetMode)}
                      disabled={totalQty === 0}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        totalQty === 0
                          ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                          : maxBetMode === 'yes'
                            ? 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100'
                            : 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100'
                      }`}
                    >
                      <div className="font-semibold truncate">{market.yes_sub_title || market.ticker}</div>
                      <div className="text-[10px] opacity-75">
                        {weightedAvgPrice !== null ? `${totalQty} @ ${weightedAvgPrice}¢` : '--'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {maxBetMode === 'off' && (
              <p className="text-xs text-gray-500">Select "Buy Yes" or "Buy No" to enable quick max bets on all strikes</p>
            )}
          </div>

          {/* Penny Bot Controls */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-yellow-800">🤖 Penny Bot</span>
                <span className="text-xs text-yellow-600">(bid &lt;90¢, qty ≥125)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">All strikes:</span>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'yes' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium"
                >
                  All Yes
                </button>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'no' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium"
                >
                  All No
                </button>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'both' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium"
                >
                  All Both
                </button>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'off' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs font-medium"
                >
                  All Off
                </button>
                <div className="w-px h-4 bg-yellow-300 mx-1"></div>
                <button
                  onClick={async () => {
                    if (!confirm(`Cancel all ${orders.length} resting orders?`)) return
                    for (const order of orders) {
                      await cancelOrder(order.order_id)
                    }
                  }}
                  className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-medium"
                >
                  Cancel All ({orders.length})
                </button>
              </div>
            </div>
          </div>

          {/* Penny Bot Log */}
          {(pennyBotLog.length > 0 || Object.values(pennyBotStrikes).some(m => m !== 'off')) && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-yellow-800">
                  🤖 Penny Bot {Object.values(pennyBotStrikes).filter(m => m !== 'off').length > 0 &&
                    `(${Object.values(pennyBotStrikes).filter(m => m !== 'off').length} active)`}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPennyBotStrikes({})}
                    className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded font-medium"
                  >
                    Stop All
                  </button>
                  <button
                    onClick={() => setPennyBotLog([])}
                    className="text-xs text-yellow-600 hover:text-yellow-800"
                  >
                    Clear Log
                  </button>
                </div>
              </div>
              <div className="bg-white rounded border border-yellow-200 p-2 max-h-24 overflow-y-auto">
                {pennyBotLog.map((log, i) => (
                  <div key={i} className="text-xs text-gray-600 font-mono">{log}</div>
                ))}
              </div>
            </div>
          )}

          <p className="text-gray-500 mb-4">{selectedEvent.markets.length} strikes available</p>

          {/* Strikes grid - 2 columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {selectedEvent.markets.map((market) => {
              const ob = orderbooks[market.ticker]
              const yesBid = ob?.yes?.[0]?.[0]
              const yesAsk = ob?.no?.[0] ? 100 - ob.no[0][0] : undefined
              const noBid = ob?.no?.[0]?.[0]
              const noAsk = ob?.yes?.[0] ? 100 - ob.yes[0][0] : undefined
              const input = orderInputs[market.ticker] || { price: '', qty: '' }

              // Get position for this market
              const position = positions.find(p => p.ticker === market.ticker)

              // Get resting orders for this market
              const marketOrders = orders.filter(o => o.ticker === market.ticker)

              // Calculate running totals for orderbook display - no limit, show all
              const yesLevels = ob?.yes || []
              const noLevels = ob?.no || []

              // YES Bids with running totals
              let yesTotal = 0
              const yesBids = yesLevels.map(([price, qty]) => {
                yesTotal += qty
                return { price, qty, total: yesTotal }
              })

              // NO Bids with running totals
              let noTotal = 0
              const noBids = noLevels.map(([price, qty]) => {
                noTotal += qty
                return { price, qty, total: noTotal }
              })

              // YES Asks (from NO bids) with running totals
              let yesAskTotal = 0
              const yesAsks = noLevels.map(([noPrice, qty]) => {
                yesAskTotal += qty
                return { price: 100 - noPrice, qty, total: yesAskTotal }
              })

              // NO Asks (from YES bids) with running totals
              let noAskTotal = 0
              const noAsks = yesLevels.map(([yesPrice, qty]) => {
                noAskTotal += qty
                return { price: 100 - yesPrice, qty, total: noAskTotal }
              })

              return (
                <div key={market.ticker} className="bg-white rounded-lg border shadow-sm">
                  {/* Strike header with Yes/No buttons */}
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openStrikeDetail(market)}>
                        <h3 className="font-semibold text-gray-900 truncate hover:text-blue-600">
                          {market.yes_sub_title || market.title}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">{market.ticker} <span className="text-blue-500">· View details</span></p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => placeOrder(market.ticker, 'yes', 'buy')}
                          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-sm min-w-[80px]"
                        >
                          Yes {yesBid !== undefined ? `${yesBid}¢` : '--'}
                        </button>
                        <button
                          onClick={() => placeOrder(market.ticker, 'no', 'buy')}
                          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium text-sm min-w-[80px]"
                        >
                          No {noBid !== undefined ? `${noBid}¢` : '--'}
                        </button>
                      </div>
                    </div>

                    {/* Penny Bot per-strike toggle */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">🤖 Penny</span>
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded p-0.5">
                          {(['off', 'yes', 'no', 'both'] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setPennyBotStrikes(prev => ({ ...prev, [market.ticker]: mode }))}
                              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                (pennyBotStrikes[market.ticker] || 'off') === mode
                                  ? mode === 'off' ? 'bg-gray-500 text-white'
                                    : mode === 'yes' ? 'bg-green-500 text-white'
                                    : mode === 'no' ? 'bg-red-500 text-white'
                                    : 'bg-blue-500 text-white'
                                  : 'text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {mode === 'off' ? 'Off' : mode === 'yes' ? 'Y' : mode === 'no' ? 'N' : 'Both'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {pennyBotStrikes[market.ticker] && pennyBotStrikes[market.ticker] !== 'off' && (
                        <span className="text-xs text-yellow-600 font-medium">Active</span>
                      )}
                    </div>

                    {/* Position display with close button */}
                    {position && position.position !== 0 && (
                      <div className={`mt-2 px-3 py-1.5 rounded-md text-sm ${position.position > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        <div className="flex items-center justify-between">
                          <span>
                            Position: <span className="font-semibold">{position.position > 0 ? 'Yes' : 'No'} {Math.abs(position.position)}</span>
                            {position.market_exposure !== undefined && (
                              <span className="text-xs opacity-75 ml-2">
                                @ {Math.round(Math.abs(position.market_exposure) / Math.abs(position.position))}¢
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() => {
                              const side = position.position > 0 ? 'yes' : 'no'
                              const qty = Math.abs(position.position)
                              setOrderInputs(prev => ({
                                ...prev,
                                [market.ticker]: { price: '', qty: String(qty) }
                              }))
                            }}
                            className="px-2 py-0.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-medium"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Resting orders display */}
                    {marketOrders.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {marketOrders.map(order => (
                          <div key={order.order_id} className={`flex items-center justify-between px-3 py-1.5 rounded-md text-xs ${order.side === 'yes' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            <span>
                              <span className="font-semibold">{order.side === 'yes' ? 'YES' : 'NO'}</span>
                              {' '}<span className="font-medium">{order.remaining_count}</span> @ <span className="font-medium">{order.side === 'yes' ? order.yes_price : order.no_price}¢</span>
                              <span className="text-gray-500 ml-1">({order.action})</span>
                            </span>
                            <button
                              onClick={() => cancelOrder(order.order_id)}
                              className="text-red-600 hover:text-red-800 font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Side-by-side orderbooks - Kalshi style with Bid/Ask */}
                  <div className="grid grid-cols-2 divide-x">
                    {/* YES Orderbook */}
                    <div className="p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                        Yes
                      </div>
                      <div className="text-xs">
                        <div className="flex text-gray-500 border-b pb-1 mb-1">
                          <span className="flex-1">Price</span>
                          <span className="w-12 text-right">Qty</span>
                          <span className="w-12 text-right">Total</span>
                        </div>
                        {/* YES Asks - scrollable, highest at top, starts scrolled to bottom */}
                        <div className="max-h-24 overflow-y-auto flex flex-col-reverse">
                          {yesAsks.length > 0 ? [...yesAsks].reverse().map((level, i, arr) => {
                            const totalFromHere = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`ask-${i}`}
                                className="flex bg-red-50 cursor-pointer hover:bg-red-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromHere) }
                                }))}
                              >
                                <span className="flex-1 text-red-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-red-600">{level.qty}</span>
                                <span className="w-12 text-right text-red-400">{totalFromHere}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-red-300 py-1 text-center">--</div>
                          )}
                        </div>
                        {/* Spread */}
                        <div className="border-y bg-gray-100 text-center py-1 text-[10px] text-gray-500 font-medium my-1">
                          {yesBid !== undefined && yesAsk !== undefined
                            ? `Spread: ${yesAsk - yesBid}¢`
                            : 'Spread: --'}
                        </div>
                        {/* YES Bids - scrollable, highest at top, total from spread */}
                        <div className="max-h-24 overflow-y-auto">
                          {yesBids.length > 0 ? [...yesBids].reverse().map((level, i, arr) => {
                            const totalFromSpread = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`bid-${i}`}
                                className="flex bg-green-50 cursor-pointer hover:bg-green-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromSpread) }
                                }))}
                              >
                                <span className="flex-1 text-green-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-green-600">{level.qty}</span>
                                <span className="w-12 text-right text-green-400">{totalFromSpread}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-green-300 py-1 text-center">--</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* NO Orderbook */}
                    <div className="p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                        No
                      </div>
                      <div className="text-xs">
                        <div className="flex text-gray-500 border-b pb-1 mb-1">
                          <span className="flex-1">Price</span>
                          <span className="w-12 text-right">Qty</span>
                          <span className="w-12 text-right">Total</span>
                        </div>
                        {/* NO Asks - scrollable, highest at top, starts scrolled to bottom */}
                        <div className="max-h-24 overflow-y-auto flex flex-col-reverse">
                          {noAsks.length > 0 ? [...noAsks].reverse().map((level, i, arr) => {
                            const totalFromHere = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`ask-${i}`}
                                className="flex bg-red-50 cursor-pointer hover:bg-red-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromHere) }
                                }))}
                              >
                                <span className="flex-1 text-red-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-red-600">{level.qty}</span>
                                <span className="w-12 text-right text-red-400">{totalFromHere}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-red-300 py-1 text-center">--</div>
                          )}
                        </div>
                        {/* Spread */}
                        <div className="border-y bg-gray-100 text-center py-1 text-[10px] text-gray-500 font-medium my-1">
                          {noBid !== undefined && noAsk !== undefined
                            ? `Spread: ${noAsk - noBid}¢`
                            : 'Spread: --'}
                        </div>
                        {/* NO Bids - scrollable, highest at top, total from spread */}
                        <div className="max-h-24 overflow-y-auto">
                          {noBids.length > 0 ? [...noBids].reverse().map((level, i, arr) => {
                            const totalFromSpread = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`bid-${i}`}
                                className="flex bg-green-50 cursor-pointer hover:bg-green-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromSpread) }
                                }))}
                              >
                                <span className="flex-1 text-green-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-green-600">{level.qty}</span>
                                <span className="w-12 text-right text-green-400">{totalFromSpread}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-green-300 py-1 text-center">--</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Order entry - Yes buttons | Inputs | No buttons */}
                  <div className="flex items-center justify-between p-3 border-t bg-gray-50">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => placeOrder(market.ticker, 'yes', 'buy')}
                        className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                      >
                        Buy Yes
                      </button>
                      <button
                        onClick={() => placeOrder(market.ticker, 'yes', 'sell')}
                        className="px-3 py-1.5 bg-green-100 text-green-700 border border-green-300 rounded text-xs font-medium hover:bg-green-200"
                      >
                        Sell Yes
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder="Price ¢"
                        value={input.price}
                        onChange={(e) => setOrderInputs(prev => ({
                          ...prev,
                          [market.ticker]: { ...prev[market.ticker], price: e.target.value }
                        }))}
                        className="w-20 border rounded px-2 py-1.5 text-sm text-center"
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        value={input.qty}
                        onChange={(e) => setOrderInputs(prev => ({
                          ...prev,
                          [market.ticker]: { ...prev[market.ticker], qty: e.target.value }
                        }))}
                        className="w-16 border rounded px-2 py-1.5 text-sm text-center"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => placeOrder(market.ticker, 'no', 'buy')}
                        className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
                      >
                        Buy No
                      </button>
                      <button
                        onClick={() => placeOrder(market.ticker, 'no', 'sell')}
                        className="px-3 py-1.5 bg-red-100 text-red-700 border border-red-300 rounded text-xs font-medium hover:bg-red-200"
                      >
                        Sell No
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        // Market list view
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* Search and Controls */}
          <div className="mb-6 flex items-center justify-between gap-4">
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md bg-white border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {Object.values(pennyBotStrikes).some(m => m !== 'off') && (
              <button
                onClick={() => setPennyBotStrikes({})}
                className="bg-red-100 text-red-700 hover:bg-red-200 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap"
              >
                🛑 Stop All Penny Bots ({Object.values(pennyBotStrikes).filter(m => m !== 'off').length})
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((event) => {
                const eventTicker = event.event_ticker || event.ticker
                const eventDate = parseEventDate(eventTicker)
                const status = getEventStatus(eventTicker)

                return (
                  <div
                    key={event.ticker}
                    onClick={() => setSelectedEvent(event)}
                    className={`bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all ${
                      status === 'today' ? 'ring-2 ring-green-400' : ''
                    }`}
                  >
                    {/* Date badge and Bot toggle */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {eventDate && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                            status === 'today' ? 'bg-green-100 text-green-700' :
                            status === 'past' ? 'bg-gray-100 text-gray-500' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {status === 'today' ? 'TODAY' : eventDate}
                          </span>
                        )}
                        {event.sub_title && (
                          <span className="text-xs text-gray-500 truncate">
                            {event.sub_title}
                          </span>
                        )}
                      </div>
                      {/* Bot toggle for this game */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleBotForEvent(eventTicker)
                        }}
                        className={`text-xs px-2 py-1 rounded font-medium transition-all ${
                          botEnabledEvents.has(eventTicker)
                            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={botEnabledEvents.has(eventTicker) ? 'Bot enabled - click to disable' : 'Click to enable bot'}
                      >
                        🤖 {botEnabledEvents.has(eventTicker) ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    <h3 className="font-medium text-gray-900 mb-3 line-clamp-2">{event.title}</h3>

                    {/* Preview strikes */}
                    <div className="space-y-1.5">
                      {event.markets.slice(0, 4).map((market) => (
                        <div key={market.ticker} className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 truncate mr-2">
                            {market.yes_sub_title || market.title}
                          </span>
                          <span className="font-medium">
                            {market.last_price ? `${market.last_price}%` : '--'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {event.markets.length > 4 && (
                      <div className="text-xs text-blue-600 mt-2">
                        +{event.markets.length - 4} more strikes
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {events.length === 0 && !loading && (
            <div className="text-center text-gray-500 py-10">
              No markets found
            </div>
          )}
        </div>
      )}

      {/* Positions Panel - Collapsible */}
      {positions.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50">
          {showPositions ? (
            <div className="bg-white rounded-lg shadow-lg border w-72">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-100 rounded-t-lg">
                <h3 className="font-medium text-sm">Positions ({positions.length})</h3>
                <button
                  onClick={() => setShowPositions(false)}
                  className="w-6 h-6 flex items-center justify-center bg-gray-300 hover:bg-gray-400 text-gray-700 rounded text-sm font-bold"
                >
                  −
                </button>
              </div>
              <div className="p-3 space-y-2 overflow-y-auto max-h-48">
                {positions.map((pos) => (
                  <div key={pos.ticker} className="text-xs">
                    <div className="truncate text-gray-700">
                      {pos.yes_sub_title || pos.market_title || pos.ticker}
                    </div>
                    <span className={pos.position > 0 ? 'text-green-600' : 'text-red-600'}>
                      {pos.position > 0 ? 'Yes' : 'No'} {Math.abs(pos.position)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowPositions(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-lg px-4 py-2 text-sm font-medium"
            >
              Positions ({positions.length})
            </button>
          )}
        </div>
      )}

      {/* Strike Detail Modal */}
      {selectedStrike && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gray-900 text-white">
              <div className="flex items-center gap-4">
                <div>
                  <h2 className="text-lg font-bold">{selectedStrike.yes_sub_title || selectedStrike.title}</h2>
                  <p className="text-xs text-gray-400">{selectedStrike.ticker}</p>
                </div>
                {/* Current price display */}
                {strikeOrderbook && (
                  <div className="flex items-center gap-4 ml-4">
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Bid</div>
                      <div className="text-lg font-bold text-green-400">
                        {strikeOrderbook.yes?.[0]?.[0] || '--'}¢
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Ask</div>
                      <div className="text-lg font-bold text-red-400">
                        {strikeOrderbook.no?.[0] ? 100 - strikeOrderbook.no[0][0] : '--'}¢
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Spread</div>
                      <div className="text-lg font-medium text-gray-300">
                        {strikeOrderbook.yes?.[0] && strikeOrderbook.no?.[0]
                          ? `${(100 - strikeOrderbook.no[0][0]) - strikeOrderbook.yes[0][0]}¢`
                          : '--'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedStrike(null)}
                className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-gray-300 text-xl"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)] bg-gray-900">
              {/* Trading Controls */}
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between">
                  {/* YES Trading */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const input = orderInputs[selectedStrike.ticker]
                        if (!input?.qty) { alert('Enter quantity'); return }
                        placeOrder(selectedStrike.ticker, 'yes', 'buy')
                      }}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
                    >
                      Buy Yes
                    </button>
                    <button
                      onClick={() => {
                        const input = orderInputs[selectedStrike.ticker]
                        if (!input?.qty) { alert('Enter quantity'); return }
                        placeOrder(selectedStrike.ticker, 'yes', 'sell')
                      }}
                      className="px-4 py-2 bg-green-900 hover:bg-green-800 text-green-300 border border-green-600 rounded-lg font-medium"
                    >
                      Sell Yes
                    </button>
                  </div>

                  {/* Price/Qty Inputs */}
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Price (¢)</label>
                      <input
                        type="number"
                        placeholder="Limit"
                        value={orderInputs[selectedStrike.ticker]?.price || ''}
                        onChange={(e) => setOrderInputs(prev => ({
                          ...prev,
                          [selectedStrike.ticker]: { ...prev[selectedStrike.ticker], price: e.target.value }
                        }))}
                        className="w-24 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Quantity</label>
                      <input
                        type="number"
                        placeholder="Qty"
                        value={orderInputs[selectedStrike.ticker]?.qty || ''}
                        onChange={(e) => setOrderInputs(prev => ({
                          ...prev,
                          [selectedStrike.ticker]: { ...prev[selectedStrike.ticker], qty: e.target.value }
                        }))}
                        className="w-20 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-center"
                      />
                    </div>
                    {/* Quick qty buttons */}
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1">
                        {[10, 25, 50].map(q => (
                          <button
                            key={q}
                            onClick={() => setOrderInputs(prev => ({
                              ...prev,
                              [selectedStrike.ticker]: { ...prev[selectedStrike.ticker], qty: String(q) }
                            }))}
                            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        {[100, 250, 500].map(q => (
                          <button
                            key={q}
                            onClick={() => setOrderInputs(prev => ({
                              ...prev,
                              [selectedStrike.ticker]: { ...prev[selectedStrike.ticker], qty: String(q) }
                            }))}
                            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* NO Trading */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const input = orderInputs[selectedStrike.ticker]
                        if (!input?.qty) { alert('Enter quantity'); return }
                        placeOrder(selectedStrike.ticker, 'no', 'buy')
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
                    >
                      Buy No
                    </button>
                    <button
                      onClick={() => {
                        const input = orderInputs[selectedStrike.ticker]
                        if (!input?.qty) { alert('Enter quantity'); return }
                        placeOrder(selectedStrike.ticker, 'no', 'sell')
                      }}
                      className="px-4 py-2 bg-red-900 hover:bg-red-800 text-red-300 border border-red-600 rounded-lg font-medium"
                    >
                      Sell No
                    </button>
                  </div>
                </div>

                {/* Take liquidity buttons */}
                <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-gray-700">
                  <button
                    onClick={() => {
                      const ask = strikeOrderbook?.no?.[0] ? 100 - strikeOrderbook.no[0][0] : null
                      const qty = strikeOrderbook?.no?.reduce((sum, [_, q]) => sum + q, 0) || 0
                      if (ask && qty > 0) {
                        setOrderInputs(prev => ({
                          ...prev,
                          [selectedStrike.ticker]: { price: String(ask), qty: String(qty) }
                        }))
                      }
                    }}
                    className="px-3 py-1.5 bg-green-800 hover:bg-green-700 text-green-200 rounded text-sm"
                  >
                    Take All Yes ({strikeOrderbook?.no?.reduce((sum, [_, q]) => sum + q, 0) || 0})
                  </button>
                  <button
                    onClick={() => {
                      const ask = strikeOrderbook?.yes?.[0] ? 100 - strikeOrderbook.yes[0][0] : null
                      const qty = strikeOrderbook?.yes?.reduce((sum, [_, q]) => sum + q, 0) || 0
                      if (ask && qty > 0) {
                        setOrderInputs(prev => ({
                          ...prev,
                          [selectedStrike.ticker]: { price: String(ask), qty: String(qty) }
                        }))
                      }
                    }}
                    className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-red-200 rounded text-sm"
                  >
                    Take All No ({strikeOrderbook?.yes?.reduce((sum, [_, q]) => sum + q, 0) || 0})
                  </button>
                </div>
              </div>

              {/* Time Period Selector */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-gray-400">Period:</span>
                {[
                  { label: '1m', value: 1 },
                  { label: '5m', value: 5 },
                  { label: '15m', value: 15 },
                  { label: '1h', value: 60 },
                  { label: '1d', value: 1440 },
                ].map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => changeHistoryPeriod(value)}
                    className={`px-3 py-1 rounded text-sm ${historyPeriod === value ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Price Chart - Trading Style */}
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm text-gray-300">Price Chart</h3>
                  {strikeHistory.length > 0 && (
                    <div className="text-xs text-gray-400">
                      High: {Math.max(...strikeHistory.map(p => p.yes_price || 0))}¢ ·
                      Low: {Math.min(...strikeHistory.filter(p => p.yes_price > 0).map(p => p.yes_price))}¢
                    </div>
                  )}
                </div>
                {strikeHistory.length > 0 ? (
                  <div className="relative">
                    {/* Y-axis labels */}
                    <div className="absolute left-0 top-0 bottom-6 w-10 flex flex-col justify-between text-xs text-gray-500">
                      {(() => {
                        const prices = strikeHistory.map(p => p.yes_price || 50)
                        const minPrice = Math.max(0, Math.min(...prices) - 5)
                        const maxPrice = Math.min(100, Math.max(...prices) + 5)
                        const range = maxPrice - minPrice || 1
                        return [100, 75, 50, 25, 0]
                          .filter(v => v >= minPrice && v <= maxPrice)
                          .map(v => (
                            <span key={v} style={{ position: 'absolute', top: `${((maxPrice - v) / range) * 100}%` }}>
                              {v}¢
                            </span>
                          ))
                      })()}
                    </div>

                    {/* Chart area */}
                    <div className="ml-12 h-48 relative border-l border-b border-gray-700">
                      {/* Grid lines */}
                      {[25, 50, 75].map(v => {
                        const prices = strikeHistory.map(p => p.yes_price || 50)
                        const minPrice = Math.max(0, Math.min(...prices) - 5)
                        const maxPrice = Math.min(100, Math.max(...prices) + 5)
                        const range = maxPrice - minPrice || 1
                        if (v < minPrice || v > maxPrice) return null
                        return (
                          <div
                            key={v}
                            className="absolute left-0 right-0 border-t border-gray-700 border-dashed"
                            style={{ top: `${((maxPrice - v) / range) * 100}%` }}
                          />
                        )
                      })}

                      {/* Candlestick/Bar chart */}
                      <svg className="w-full h-full" preserveAspectRatio="none">
                        {(() => {
                          const data = strikeHistory.slice(-60)
                          if (data.length === 0) return null

                          const prices = data.map(p => p.yes_price || 50)
                          const minPrice = Math.max(0, Math.min(...prices) - 5)
                          const maxPrice = Math.min(100, Math.max(...prices) + 5)
                          const range = maxPrice - minPrice || 1

                          const barWidth = 100 / data.length

                          return data.map((point, i) => {
                            const x = (i / data.length) * 100
                            const price = point.yes_price || 50
                            const bid = point.yes_bid || price
                            const ask = point.yes_ask || price

                            // Candlestick body
                            const open = i > 0 ? (data[i-1].yes_price || 50) : price
                            const close = price
                            const high = Math.max(open, close, ask)
                            const low = Math.min(open, close, bid)

                            const isGreen = close >= open
                            const bodyTop = ((maxPrice - Math.max(open, close)) / range) * 100
                            const bodyBottom = ((maxPrice - Math.min(open, close)) / range) * 100
                            const wickTop = ((maxPrice - high) / range) * 100
                            const wickBottom = ((maxPrice - low) / range) * 100

                            return (
                              <g key={i}>
                                {/* Wick */}
                                <line
                                  x1={`${x + barWidth/2}%`}
                                  y1={`${wickTop}%`}
                                  x2={`${x + barWidth/2}%`}
                                  y2={`${wickBottom}%`}
                                  stroke={isGreen ? '#22c55e' : '#ef4444'}
                                  strokeWidth="1"
                                />
                                {/* Body */}
                                <rect
                                  x={`${x + barWidth * 0.1}%`}
                                  y={`${bodyTop}%`}
                                  width={`${barWidth * 0.8}%`}
                                  height={`${Math.max(bodyBottom - bodyTop, 0.5)}%`}
                                  fill={isGreen ? '#22c55e' : '#ef4444'}
                                  opacity={0.9}
                                />
                              </g>
                            )
                          })
                        })()}

                        {/* Price line overlay */}
                        <polyline
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth="2"
                          points={(() => {
                            const data = strikeHistory.slice(-60)
                            if (data.length === 0) return ''

                            const prices = data.map(p => p.yes_price || 50)
                            const minPrice = Math.max(0, Math.min(...prices) - 5)
                            const maxPrice = Math.min(100, Math.max(...prices) + 5)
                            const range = maxPrice - minPrice || 1

                            return data.map((point, i) => {
                              const x = (i / data.length) * 100
                              const y = ((maxPrice - (point.yes_price || 50)) / range) * 100
                              return `${x},${y}`
                            }).join(' ')
                          })()}
                        />
                      </svg>

                      {/* Current price marker */}
                      {strikeHistory.length > 0 && (
                        <div
                          className="absolute right-0 transform translate-x-1 -translate-y-1/2 bg-blue-600 text-white text-xs px-1 rounded"
                          style={{
                            top: (() => {
                              const prices = strikeHistory.map(p => p.yes_price || 50)
                              const minPrice = Math.max(0, Math.min(...prices) - 5)
                              const maxPrice = Math.min(100, Math.max(...prices) + 5)
                              const range = maxPrice - minPrice || 1
                              const lastPrice = strikeHistory[strikeHistory.length - 1]?.yes_price || 50
                              return `${((maxPrice - lastPrice) / range) * 100}%`
                            })()
                          }}
                        >
                          {strikeHistory[strikeHistory.length - 1]?.yes_price}¢
                        </div>
                      )}
                    </div>

                    {/* X-axis labels */}
                    <div className="ml-12 flex justify-between text-xs text-gray-500 mt-1">
                      <span>{new Date(strikeHistory[0]?.ts * 1000).toLocaleTimeString()}</span>
                      <span>{new Date(strikeHistory[Math.floor(strikeHistory.length/2)]?.ts * 1000).toLocaleTimeString()}</span>
                      <span>{new Date(strikeHistory[strikeHistory.length - 1]?.ts * 1000).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center text-gray-500">
                    No price history available
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full Orderbook - Trading Style */}
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="font-medium text-sm mb-3 text-gray-300">Orderbook</h3>
                  <div className="text-xs">
                    {/* Headers */}
                    <div className="flex text-gray-500 border-b border-gray-700 pb-1 mb-1">
                      <span className="flex-1">Price</span>
                      <span className="w-16 text-right">Qty</span>
                      <span className="w-16 text-right">Total</span>
                    </div>

                    {/* Asks (sell orders) - red, reversed so lowest ask at bottom */}
                    <div className="max-h-32 overflow-y-auto flex flex-col-reverse">
                      {strikeOrderbook?.no && [...strikeOrderbook.no].map(([noPrice, qty], i, arr) => {
                        const askPrice = 100 - noPrice
                        const total = arr.slice(0, i + 1).reduce((sum, [_, q]) => sum + q, 0)
                        const maxQty = Math.max(...arr.map(([_, q]) => q))
                        return (
                          <div
                            key={i}
                            className="flex relative cursor-pointer hover:bg-red-900/50"
                            onClick={() => setOrderInputs(prev => ({
                              ...prev,
                              [selectedStrike.ticker]: { price: String(askPrice), qty: String(total) }
                            }))}
                          >
                            <div
                              className="absolute inset-y-0 right-0 bg-red-900/30"
                              style={{ width: `${(qty / maxQty) * 100}%` }}
                            />
                            <span className="flex-1 text-red-400 relative z-10">{askPrice}¢</span>
                            <span className="w-16 text-right text-gray-300 relative z-10">{qty}</span>
                            <span className="w-16 text-right text-gray-500 relative z-10">{total}</span>
                          </div>
                        )
                      })}
                      {(!strikeOrderbook?.no || strikeOrderbook.no.length === 0) && (
                        <div className="text-gray-600 py-2 text-center">No asks</div>
                      )}
                    </div>

                    {/* Spread indicator */}
                    <div className="border-y border-gray-700 py-1.5 my-1 text-center bg-gray-900">
                      <span className="text-gray-400">Spread: </span>
                      <span className="text-white font-medium">
                        {strikeOrderbook?.yes?.[0] && strikeOrderbook?.no?.[0]
                          ? `${(100 - strikeOrderbook.no[0][0]) - strikeOrderbook.yes[0][0]}¢`
                          : '--'}
                      </span>
                    </div>

                    {/* Bids (buy orders) - green */}
                    <div className="max-h-32 overflow-y-auto">
                      {strikeOrderbook?.yes && [...strikeOrderbook.yes].reverse().map(([price, qty], i, arr) => {
                        const total = arr.slice(0, i + 1).reduce((sum, [_, q]) => sum + q, 0)
                        const maxQty = Math.max(...arr.map(([_, q]) => q))
                        return (
                          <div
                            key={i}
                            className="flex relative cursor-pointer hover:bg-green-900/50"
                            onClick={() => setOrderInputs(prev => ({
                              ...prev,
                              [selectedStrike.ticker]: { price: String(price), qty: String(total) }
                            }))}
                          >
                            <div
                              className="absolute inset-y-0 right-0 bg-green-900/30"
                              style={{ width: `${(qty / maxQty) * 100}%` }}
                            />
                            <span className="flex-1 text-green-400 relative z-10">{price}¢</span>
                            <span className="w-16 text-right text-gray-300 relative z-10">{qty}</span>
                            <span className="w-16 text-right text-gray-500 relative z-10">{total}</span>
                          </div>
                        )
                      })}
                      {(!strikeOrderbook?.yes || strikeOrderbook.yes.length === 0) && (
                        <div className="text-gray-600 py-2 text-center">No bids</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Recent Trades - Time & Sales */}
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="font-medium text-sm mb-3 text-gray-300">Time & Sales</h3>
                  <div className="text-xs">
                    <div className="flex text-gray-500 border-b border-gray-700 pb-1 mb-1">
                      <span className="flex-1">Time</span>
                      <span className="w-16 text-right">Price</span>
                      <span className="w-16 text-right">Size</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-0.5">
                      {strikeTrades.length > 0 ? strikeTrades.map((trade) => (
                        <div key={trade.trade_id} className="flex items-center py-0.5">
                          <span className="flex-1 text-gray-400">
                            {new Date(trade.created_time).toLocaleTimeString()}
                          </span>
                          <span className={`w-16 text-right font-medium ${trade.taker_side === 'yes' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.yes_price}¢
                          </span>
                          <span className="w-16 text-right text-gray-300">{trade.count}</span>
                        </div>
                      )) : (
                        <div className="text-gray-600 py-2 text-center">No recent trades</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

# Smart Money Detector

Real-time detection of suspicious trading activity on Polymarket that may indicate insider trading.

## Overview

This system monitors Polymarket trades in real-time and alerts when it detects unusual trading patterns that could indicate informed traders ("smart money") acting before news breaks.

**Key insight**: A $500 trade on a market where the median trade is $4 is highly suspicious. The same $500 on a market where the median is $200 is normal. We use **percentile-based detection** rather than fixed dollar thresholds.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ON STARTUP                                   │
├─────────────────────────────────────────────────────────────────────┤
│  1. Fetch ALL active markets from Polymarket API (~500 markets)     │
│  2. Filter to "insider-plausible" markets based on keywords         │
│  3. Subscribe to WebSocket for those markets' token IDs             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      REAL-TIME MONITORING                            │
├─────────────────────────────────────────────────────────────────────┤
│  WebSocket receives every trade on subscribed markets               │
│                                                                      │
│  For each trade:                                                     │
│    1. Add to MarketStats (builds percentile distribution)           │
│    2. Check: Is this a low-price BUY (<25%)?                        │
│    3. Check: What percentile is this trade for this market?         │
│    4. If 90th+ percentile at low price → ALERT via Telegram         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PERIODIC TASKS                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Every 30 min: Refresh markets (catch newly created ones)           │
│  Every 5 min:  Log statistics                                       │
│  Every 1 hour: Cleanup old trade data                               │
└─────────────────────────────────────────────────────────────────────┘
```

## Detection Methods

### 1. Unusual Low-Price Buy (PRIMARY - Percentile-Based)

The most important detection for insider trading. Flags BUY trades at low prices that are unusually large relative to the market's typical activity.

**How it works:**
- Only checks BUY trades at prices <25% (high upside potential)
- Maintains a sorted list of all low-price buy sizes per market
- Calculates the percentile of each new trade
- Alerts based on percentile:
  - **90th percentile** → MEDIUM severity
  - **95th percentile** → HIGH severity
  - **99th percentile** → CRITICAL severity

**Example from Maduro market validation:**
```
Market: "Maduro out by Jan 31"
Median trade: $3.90
99th percentile: $537

Trade: $500 BUY at 6%
→ 98.6th percentile (top 1.4%)
→ ALERT: "INSIDER SIGNAL - $500 BUY, #24 of 1719 trades"
```

### 2. Large Trade (Absolute Threshold)

Catches whale trades that exceed fixed dollar thresholds.

- **$5,000+** → MEDIUM
- **$10,000+** → HIGH
- **$25,000+** → CRITICAL

### 3. Volume Spike

Detects when trading volume in a 5-minute window is abnormally high compared to the market's baseline.

- **5x normal** → MEDIUM
- **10x normal** → HIGH
- **20x normal** → CRITICAL

### 4. Rapid Price Move

Flags sudden price movements without obvious news.

- **5%+ in 5 min** → MEDIUM
- **10%+ in 5 min** → HIGH
- **20%+ in 5 min** → CRITICAL

## Market Selection

Markets are **automatically selected** based on keyword matching. No manual configuration needed.

### Included (Insider-Plausible)

| Category | Keywords |
|----------|----------|
| Politics | resign, indicted, pardon, nominate, impeach, cabinet |
| Regulatory | FDA, SEC, ruling, verdict, lawsuit, merger |
| Macro | fed, FOMC, rate cut, inflation, GDP, jobs |
| Geopolitics | ceasefire, invasion, coup, treaty, sanctions |
| Elections | vote, ballot, candidate, primary, electoral |
| Crypto | bitcoin, ethereum, solana, ETF, token, DeFi |

### Excluded (No Insider Edge)

- Sports (NFL, NBA, UFC, etc.)
- Entertainment (YouTube, TikTok, movies, awards)
- Weather predictions
- Social media metrics (tweets, followers, views)

## File Structure

```
src/smart-money/
├── index.ts           # Entry point - run with `npx ts-node src/smart-money/index.ts`
├── detector.ts        # Main orchestrator - WebSocket, market management
├── anomaly-engine.ts  # Detection logic - all anomaly checks
├── market-stats.ts    # Per-market trade statistics for percentile calc
├── market-filter.ts   # Keyword-based market selection
├── alerts.ts          # Telegram alert formatting and rate limiting
├── baseline.ts        # Rolling baseline calculations (volume, trade size)
├── trade-store.ts     # In-memory trade storage with cleanup
├── trade-recorder.ts  # CSV recording for backtesting
└── types.ts           # TypeScript interfaces
```

## Configuration

Default config in `types.ts`:

```typescript
{
  // Large trade thresholds (USD)
  largeTradeMin: 5000,
  largeTradeHigh: 10000,
  largeTradeCritical: 25000,

  // Volume spike (multiple of baseline)
  volumeSpikeWindowMs: 5 * 60 * 1000,  // 5 minutes
  volumeSpikeLow: 5,      // 5x normal
  volumeSpikeHigh: 10,    // 10x normal
  volumeSpikeCritical: 20, // 20x normal

  // Price movement
  priceWindowMs: 5 * 60 * 1000,  // 5 minutes
  priceChangeLow: 0.05,    // 5%
  priceChangeHigh: 0.10,   // 10%
  priceChangeCritical: 0.20, // 20%

  // Percentile thresholds (in market-stats.ts)
  lowPriceThreshold: 0.25,  // Only flag buys below 25%
  mediumPercentile: 0.90,   // 90th percentile
  highPercentile: 0.95,     // 95th percentile
  criticalPercentile: 0.99, // 99th percentile

  // Alerts
  alertCooldownMs: 5 * 60 * 1000,  // 5 min cooldown per market+type
  maxAlertsPerHour: 20,
  minSeverity: 'MEDIUM',
}
```

## Running

### Locally

```bash
cd agent
npx ts-node src/smart-money/index.ts
```

Options:
```bash
--min-trade=10000      # Only alert on trades >= $10k
--min-severity=HIGH    # Only alert on HIGH or CRITICAL
```

### On Render (24/7)

Add to `render.yaml`:

```yaml
- type: worker
  name: smart-money-detector
  env: node
  region: oregon
  plan: starter  # $7/month
  buildCommand: cd agent && npm install
  startCommand: cd agent && npx ts-node src/smart-money/index.ts
  envVars:
    - key: TELEGRAM_BOT_TOKEN
      sync: false
    - key: TELEGRAM_CHAT_ID
      sync: false
```

## Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## Alert Format

```
🚨 INSIDER SIGNAL - $500 BUY

Will Maduro leave office by January 31?

Trade: $500 at 6.0%
Rank: #24 of 1719 trades (98.6th percentile)
Median trade: $4 (this is 125x larger)

Someone placed an unusually large bet at a low price. High insider probability.

Trade: https://polymarket.com/event/maduro-out
```

## Validation

Validated against the Maduro market insider trading case (Jan 2026):

- **20 CRITICAL alerts** would have triggered before the price spike
- **81 HIGH alerts** would have triggered
- Caught suspected insider wallet `0xb6bed94e...` with multiple alerts at 6-8% prices
- System would have detected activity **days before** the news broke

## Cost

- **No LLM costs** - pure math/statistics
- **No API costs** - just free Telegram
- **Server: ~$7/month** on Render (starter worker plan)

## Limitations

1. **Cold start**: Percentile detection needs ~50 trades per market to be accurate
2. **False positives**: Large legitimate traders may trigger alerts
3. **Market selection**: Keyword-based filtering may miss some relevant markets
4. **No historical warmup**: Starts fresh on each restart (historical API requires auth)

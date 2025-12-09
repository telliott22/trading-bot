# Polymarket Trading Agent

An AI-powered trading agent that identifies **leader-follower opportunities** on [Polymarket](https://polymarket.com) prediction markets.

## What is this?

This project implements a strategy from academic research on prediction market inefficiencies ([Arxiv Paper](https://arxiv.org/pdf/2512.02436)). The core insight:

> When two markets are causally related and resolve at different times, the **leader market** (resolves first) reveals information that can be traded on the **follower market** (resolves later) before prices adjust.

**Example:** If "Fed cuts rates in December?" resolves YES, the market "Fed cuts rates in January?" likely hasn't priced in this information yet—creating a trading opportunity.

## How it works

1. **Ingestion** - Fetches active markets from Polymarket API
2. **Clustering** - Groups related markets using semantic embeddings
3. **Analysis** - Uses GPT-4 to identify leader-follower pairs with causal relationships
4. **Notifications** - Sends Telegram alerts when:
   - New trading opportunities are discovered
   - A leader market resolves (time to trade the follower!)

## Project Structure

```
├── agent/          # Node.js trading agent (runs on Render cron)
├── dashboard/      # Next.js web UI for viewing signals
└── ui/             # Shared React components
```

## Deployment

- **Agent**: Render cron job (every 6 hours)
- **Dashboard**: Vercel static site

## Setup

1. Copy `.env.example` to `agent/.env`
2. Add your API keys (OpenRouter, Telegram)
3. Run locally: `cd agent && npm install && npm start`

## Tech Stack

- TypeScript, Node.js
- OpenRouter (GPT-4 for analysis)
- Polymarket Gamma API
- Telegram Bot API
- Next.js, Tailwind CSS

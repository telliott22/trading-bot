/**
 * Historical Trade Fetcher
 * Fetches historical trade data from Polymarket for backtesting
 *
 * Uses the authenticated CLOB client for real trade-level data.
 */

import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { SmartMoneyTrade, MarketInfo } from '../smart-money/types';

const CLOB_API = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';

export interface HistoricalTradeQuery {
    marketId: string;
    conditionId?: string;
    tokenId?: string;
    startTime: number; // Unix ms
    endTime: number; // Unix ms
    limit?: number;
}

export class HistoricalFetcher {
    private client: ClobClient | null = null;

    constructor() {
        this.initClient();
    }

    private initClient(): void {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        const apiKey = process.env.POLYMARKET_API_KEY;
        const apiSecret = process.env.POLYMARKET_API_SECRET;
        const passphrase = process.env.POLYMARKET_PASSPHRASE;

        if (!privateKey || !apiKey || !apiSecret || !passphrase) {
            console.log('  Note: API credentials not found, using price history fallback');
            return;
        }

        try {
            const signer = new Wallet(privateKey);
            this.client = new ClobClient(
                CLOB_API,
                137, // Polygon mainnet
                signer,
                { key: apiKey, secret: apiSecret, passphrase }
            );
        } catch (error) {
            console.error('  Error initializing CLOB client:', error);
        }
    }

    /**
     * Fetch real trades using authenticated API, or fall back to price history
     */
    async fetchTrades(query: HistoricalTradeQuery): Promise<SmartMoneyTrade[]> {
        // Try authenticated trade API first
        if (this.client && query.conditionId) {
            const trades = await this.fetchRealTrades(query);
            if (trades.length > 0) {
                return trades;
            }
        }

        // Fall back to price history
        return this.fetchPriceHistoryTrades(query);
    }

    /**
     * Fetch real trades using the authenticated CLOB client
     */
    private async fetchRealTrades(query: HistoricalTradeQuery): Promise<SmartMoneyTrade[]> {
        if (!this.client || !query.conditionId) {
            return [];
        }

        const trades: SmartMoneyTrade[] = [];

        try {
            console.log('  Fetching real trades from CLOB API...');

            // Use getTrades with market filter - requires L2 auth
            const tradeData = await this.client.getTrades(
                {
                    market: query.conditionId,
                    after: Math.floor(query.startTime / 1000).toString(),
                    before: Math.floor(query.endTime / 1000).toString(),
                },
                false // Get all pages
            );

            if (!tradeData || !Array.isArray(tradeData)) {
                console.log('  No trade data returned');
                return [];
            }

            for (const t of tradeData) {
                const timestamp = new Date(t.match_time).getTime();
                const price = parseFloat(t.price);
                const size = parseFloat(t.size);

                trades.push({
                    marketId: query.marketId,
                    conditionId: query.conditionId,
                    tokenId: t.asset_id,
                    price,
                    size,
                    sizeUsd: size * price,
                    side: t.side,
                    timestamp,
                    makerAddress: t.maker_address,
                });
            }

            console.log(`  Got ${trades.length} real trades`);
        } catch (error: any) {
            console.log(`  Trade API error: ${error.message || error}`);
            return [];
        }

        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Fetch price history and simulate trades from price changes (fallback)
     */
    private async fetchPriceHistoryTrades(query: HistoricalTradeQuery): Promise<SmartMoneyTrade[]> {
        const trades: SmartMoneyTrade[] = [];

        if (!query.tokenId) {
            console.log('  No tokenId provided, skipping...');
            return [];
        }

        try {
            // Use price history API (public)
            // fidelity=1 gives 1-minute data points
            // For longer periods, use interval=max; for recent data, use interval=1w or 1d
            const daysRequested = (query.endTime - query.startTime) / (24 * 60 * 60 * 1000);
            const interval = daysRequested <= 1 ? '1d' : daysRequested <= 7 ? '1w' : 'max';
            const fidelity = daysRequested <= 7 ? 1 : 60; // Use minute data for shorter periods

            const url = `${CLOB_API}/prices-history?market=${query.tokenId}&interval=${interval}&fidelity=${fidelity}`;

            const response = await fetch(url);

            if (!response.ok) {
                return [];
            }

            const data = await response.json();

            if (!data.history || !Array.isArray(data.history)) {
                return [];
            }

            // Convert price history to simulated trades
            let prevPrice = 0;
            for (const point of data.history) {
                const timestamp = point.t * 1000; // Convert to ms
                const price = parseFloat(point.p);

                if (prevPrice > 0) {
                    const priceChange = price - prevPrice;
                    const side: 'BUY' | 'SELL' = priceChange > 0 ? 'BUY' : 'SELL';
                    const estimatedSize = Math.abs(priceChange) * 10000;

                    trades.push({
                        marketId: query.marketId,
                        conditionId: query.conditionId || query.marketId,
                        tokenId: query.tokenId,
                        price,
                        size: estimatedSize,
                        sizeUsd: estimatedSize * price,
                        side,
                        timestamp,
                    });
                }
                prevPrice = price;
            }
        } catch (error) {
            // Silently fail
        }

        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Fetch price history for a market
     */
    async fetchMarketHistory(
        marketId: string,
        conditionId: string,
        days: number,
        tokenId?: string
    ): Promise<SmartMoneyTrade[]> {
        const endTime = Date.now();
        const startTime = endTime - days * 24 * 60 * 60 * 1000;

        console.log(`  Fetching ${days} days of price history...`);

        const trades = await this.fetchTrades({
            marketId,
            conditionId,
            tokenId,
            startTime,
            endTime,
        });

        console.log(`  Got ${trades.length} price points`);
        return trades;
    }

    /**
     * Search for a market by keyword
     */
    async searchMarkets(keyword: string): Promise<MarketInfo[]> {
        const markets: MarketInfo[] = [];

        try {
            // Search through events
            const url = `${GAMMA_API}/events?limit=100&order=volume&ascending=false`;
            const response = await fetch(url);
            const events = await response.json();

            if (!Array.isArray(events)) return [];

            const keywordLower = keyword.toLowerCase();

            for (const event of events) {
                if (!event.markets || !Array.isArray(event.markets)) continue;

                for (const m of event.markets) {
                    const questionLower = (m.question || '').toLowerCase();
                    const descLower = (m.description || '').toLowerCase();

                    if (questionLower.includes(keywordLower) || descLower.includes(keywordLower)) {
                        // Token IDs are in clobTokenIds as JSON string
                        let tokenIds: string[] = [];
                        try {
                            if (m.clobTokenIds) {
                                tokenIds = JSON.parse(m.clobTokenIds);
                            }
                        } catch {
                            continue;
                        }

                        // Parse prices
                        let prices: number[] = [];
                        try {
                            if (m.outcomePrices) {
                                prices = JSON.parse(m.outcomePrices).map((p: string) => parseFloat(p));
                            }
                        } catch {
                            // Optional
                        }

                        markets.push({
                            id: m.id,
                            conditionId: m.conditionId || m.id,
                            slug: event.slug || m.slug,
                            question: m.question,
                            description: m.description,
                            endDate: m.endDate,
                            yesTokenId: tokenIds[0] || '',
                            noTokenId: tokenIds[1] || '',
                            currentYesPrice: prices[0],
                            currentNoPrice: prices[1],
                            volume24h: parseFloat(m.volume24hr || m.volume || '0'),
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error searching markets:', error);
        }

        return markets;
    }

    /**
     * Get market details by slug or ID
     */
    async getMarketBySlug(slug: string): Promise<MarketInfo | null> {
        try {
            const url = `${GAMMA_API}/events?slug=${slug}`;
            const response = await fetch(url);
            const events = await response.json();

            if (!Array.isArray(events) || events.length === 0) return null;

            const event = events[0];
            if (!event.markets || event.markets.length === 0) return null;

            const m = event.markets[0];

            // Token IDs are in clobTokenIds as JSON string
            let tokenIds: string[] = [];
            try {
                if (m.clobTokenIds) {
                    tokenIds = JSON.parse(m.clobTokenIds);
                }
            } catch {
                // Continue without tokens
            }

            // Parse prices
            let prices: number[] = [];
            try {
                if (m.outcomePrices) {
                    prices = JSON.parse(m.outcomePrices).map((p: string) => parseFloat(p));
                }
            } catch {
                // Optional
            }

            return {
                id: m.id,
                conditionId: m.conditionId || m.id,
                slug: event.slug || m.slug,
                question: m.question,
                description: m.description,
                endDate: m.endDate,
                yesTokenId: tokenIds[0] || '',
                noTokenId: tokenIds[1] || '',
                currentYesPrice: prices[0],
                currentNoPrice: prices[1],
                volume24h: parseFloat(m.volume24hr || m.volume || '0'),
            };
        } catch (error) {
            console.error('Error fetching market by slug:', error);
            return null;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

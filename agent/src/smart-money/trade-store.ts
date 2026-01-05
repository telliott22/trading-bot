/**
 * Trade Store
 * In-memory rolling window storage for trades per market
 */

import { SmartMoneyTrade } from './types';

interface PricePoint {
    price: number;
    timestamp: number;
}

interface MarketTradeWindow {
    trades: SmartMoneyTrade[];
    priceHistory: PricePoint[];
}

export class TradeStore {
    private windows: Map<string, MarketTradeWindow> = new Map();
    private readonly windowSizeMs: number;
    private simulatedTime: number | null = null; // For backtesting

    constructor(windowSizeMs: number = 24 * 60 * 60 * 1000) {
        this.windowSizeMs = windowSizeMs;
    }

    /**
     * Set simulated time for backtesting (uses trade timestamps instead of Date.now())
     */
    setSimulatedTime(timestamp: number): void {
        this.simulatedTime = timestamp;
    }

    /**
     * Get current time (simulated or real)
     */
    private getCurrentTime(): number {
        return this.simulatedTime ?? Date.now();
    }

    /**
     * Add a single trade to the store
     */
    addTrade(trade: SmartMoneyTrade): void {
        let window = this.windows.get(trade.marketId);
        if (!window) {
            window = { trades: [], priceHistory: [] };
            this.windows.set(trade.marketId, window);
        }

        window.trades.push(trade);
        window.priceHistory.push({
            price: trade.price,
            timestamp: trade.timestamp,
        });

        // Cleanup old data periodically (every 100 trades)
        if (window.trades.length % 100 === 0) {
            this.cleanupMarket(trade.marketId);
        }
    }

    /**
     * Bulk add trades (for historical data loading)
     */
    bulkAdd(marketId: string, trades: SmartMoneyTrade[]): void {
        let window = this.windows.get(marketId);
        if (!window) {
            window = { trades: [], priceHistory: [] };
            this.windows.set(marketId, window);
        }

        for (const trade of trades) {
            window.trades.push(trade);
            window.priceHistory.push({
                price: trade.price,
                timestamp: trade.timestamp,
            });
        }

        // Sort by timestamp
        window.trades.sort((a, b) => a.timestamp - b.timestamp);
        window.priceHistory.sort((a, b) => a.timestamp - b.timestamp);

        this.cleanupMarket(marketId);
    }

    /**
     * Get trades within a time window
     */
    getRecentTrades(marketId: string, durationMs: number): SmartMoneyTrade[] {
        const window = this.windows.get(marketId);
        if (!window) return [];

        const cutoff = this.getCurrentTime() - durationMs;
        return window.trades.filter((t) => t.timestamp >= cutoff);
    }

    /**
     * Get all trades for a market (for baseline calculation)
     */
    getAllTrades(marketId: string): SmartMoneyTrade[] {
        const window = this.windows.get(marketId);
        return window?.trades || [];
    }

    /**
     * Get total volume in USD within a time window
     */
    getVolumeInWindow(marketId: string, durationMs: number): number {
        const trades = this.getRecentTrades(marketId, durationMs);
        return trades.reduce((sum, t) => sum + t.sizeUsd, 0);
    }

    /**
     * Get trade count within a time window
     */
    getTradeCountInWindow(marketId: string, durationMs: number): number {
        return this.getRecentTrades(marketId, durationMs).length;
    }

    /**
     * Get price change within a time window
     */
    getPriceChangeInWindow(
        marketId: string,
        durationMs: number
    ): { start: number; end: number; change: number; changePercent: number } | null {
        const window = this.windows.get(marketId);
        if (!window || window.priceHistory.length === 0) return null;

        const cutoff = this.getCurrentTime() - durationMs;
        const recentPrices = window.priceHistory.filter((p) => p.timestamp >= cutoff);

        if (recentPrices.length < 2) return null;

        const start = recentPrices[0].price;
        const end = recentPrices[recentPrices.length - 1].price;
        const change = end - start;
        const changePercent = start > 0 ? change / start : 0;

        return { start, end, change, changePercent };
    }

    /**
     * Get the latest price for a market
     */
    getLatestPrice(marketId: string): number | null {
        const window = this.windows.get(marketId);
        if (!window || window.priceHistory.length === 0) return null;
        return window.priceHistory[window.priceHistory.length - 1].price;
    }

    /**
     * Get min/max prices in a window
     */
    getPriceRangeInWindow(
        marketId: string,
        durationMs: number
    ): { min: number; max: number; range: number } | null {
        const window = this.windows.get(marketId);
        if (!window || window.priceHistory.length === 0) return null;

        const cutoff = this.getCurrentTime() - durationMs;
        const recentPrices = window.priceHistory
            .filter((p) => p.timestamp >= cutoff)
            .map((p) => p.price);

        if (recentPrices.length === 0) return null;

        const min = Math.min(...recentPrices);
        const max = Math.max(...recentPrices);

        return { min, max, range: max - min };
    }

    /**
     * Clean up old trades for a specific market
     */
    private cleanupMarket(marketId: string): void {
        const window = this.windows.get(marketId);
        if (!window) return;

        const cutoff = this.getCurrentTime() - this.windowSizeMs;

        window.trades = window.trades.filter((t) => t.timestamp >= cutoff);
        window.priceHistory = window.priceHistory.filter((p) => p.timestamp >= cutoff);
    }

    /**
     * Clean up all markets
     */
    cleanup(): void {
        for (const marketId of this.windows.keys()) {
            this.cleanupMarket(marketId);
        }
    }

    /**
     * Get market IDs being tracked
     */
    getMarketIds(): string[] {
        return Array.from(this.windows.keys());
    }

    /**
     * Get stats for debugging
     */
    getStats(): { marketCount: number; totalTrades: number } {
        let totalTrades = 0;
        for (const window of this.windows.values()) {
            totalTrades += window.trades.length;
        }
        return {
            marketCount: this.windows.size,
            totalTrades,
        };
    }
}

/**
 * Market Statistics Tracker
 *
 * Tracks per-market trade size distributions to enable percentile-based
 * anomaly detection. Instead of absolute thresholds ($5K = large), we
 * flag trades that are unusual relative to the market's typical activity.
 *
 * Key insight from Maduro analysis:
 * - Median trade: $4.40
 * - 90th percentile: ~$100
 * - 98th percentile: ~$500
 * - Insider trades were $500-$3,400 (top 1-2%)
 */

export interface PercentileConfig {
    // Percentile thresholds for low-price trades
    lowPriceThreshold: number; // Only flag when price < this (e.g., 0.25 = 25%)

    // Severity thresholds (percentiles)
    mediumPercentile: number; // 90th percentile
    highPercentile: number; // 95th percentile
    criticalPercentile: number; // 99th percentile

    // Window settings
    maxSamples: number; // Max trades to keep in memory
    minSamples: number; // Min trades before percentile calculation is valid
}

export const DEFAULT_PERCENTILE_CONFIG: PercentileConfig = {
    lowPriceThreshold: 0.25, // Flag buys below 25%
    mediumPercentile: 0.90,
    highPercentile: 0.95,
    criticalPercentile: 0.99,
    maxSamples: 10000,
    minSamples: 50,
};

export interface TradeRecord {
    sizeUsd: number;
    price: number;
    timestamp: number;
    side: 'BUY' | 'SELL';
}

export interface PercentileResult {
    percentile: number; // 0.0 to 1.0 (e.g., 0.95 = 95th percentile)
    isUnusual: boolean;
    severity: 'NONE' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    rank: number; // e.g., "3 of 500"
    totalTrades: number;
    medianSize: number;
    thresholds: {
        p90: number;
        p95: number;
        p99: number;
    };
}

/**
 * Tracks trade statistics for a single market
 */
export class MarketStats {
    private trades: TradeRecord[] = [];
    private lowPriceBuys: number[] = []; // Sorted array of low-price buy sizes
    private config: PercentileConfig;
    private marketId: string;

    constructor(marketId: string, config: Partial<PercentileConfig> = {}) {
        this.marketId = marketId;
        this.config = { ...DEFAULT_PERCENTILE_CONFIG, ...config };
    }

    /**
     * Add a trade to the statistics
     */
    addTrade(trade: TradeRecord): void {
        this.trades.push(trade);

        // Track low-price buys separately for percentile calculation
        if (trade.side === 'BUY' && trade.price < this.config.lowPriceThreshold) {
            this.insertSorted(this.lowPriceBuys, trade.sizeUsd);
        }

        // Trim if over max
        if (this.trades.length > this.config.maxSamples) {
            const removed = this.trades.shift();
            if (
                removed &&
                removed.side === 'BUY' &&
                removed.price < this.config.lowPriceThreshold
            ) {
                this.removeSorted(this.lowPriceBuys, removed.sizeUsd);
            }
        }
    }

    /**
     * Calculate the percentile of a given trade size for low-price buys
     */
    getPercentile(sizeUsd: number): PercentileResult {
        const n = this.lowPriceBuys.length;

        // Not enough data
        if (n < this.config.minSamples) {
            return {
                percentile: 0,
                isUnusual: false,
                severity: 'NONE',
                rank: 0,
                totalTrades: n,
                medianSize: 0,
                thresholds: { p90: 0, p95: 0, p99: 0 },
            };
        }

        // Count how many trades are smaller than this one
        const smallerCount = this.countSmaller(this.lowPriceBuys, sizeUsd);
        const percentile = smallerCount / n;
        const rank = n - smallerCount;

        // Calculate thresholds
        const p90 = this.lowPriceBuys[Math.floor(n * 0.9)] || 0;
        const p95 = this.lowPriceBuys[Math.floor(n * 0.95)] || 0;
        const p99 = this.lowPriceBuys[Math.floor(n * 0.99)] || 0;
        const median = this.lowPriceBuys[Math.floor(n * 0.5)] || 0;

        // Determine severity
        let severity: 'NONE' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'NONE';
        if (percentile >= this.config.criticalPercentile) {
            severity = 'CRITICAL';
        } else if (percentile >= this.config.highPercentile) {
            severity = 'HIGH';
        } else if (percentile >= this.config.mediumPercentile) {
            severity = 'MEDIUM';
        }

        return {
            percentile,
            isUnusual: severity !== 'NONE',
            severity,
            rank,
            totalTrades: n,
            medianSize: median,
            thresholds: { p90, p95, p99 },
        };
    }

    /**
     * Check if a trade should trigger an alert based on percentile
     */
    shouldAlert(sizeUsd: number, price: number, side: 'BUY' | 'SELL'): PercentileResult | null {
        // Only check low-price buys (high upside potential)
        if (side !== 'BUY' || price >= this.config.lowPriceThreshold) {
            return null;
        }

        const result = this.getPercentile(sizeUsd);
        if (result.isUnusual) {
            return result;
        }
        return null;
    }

    /**
     * Get current statistics summary
     */
    getStats(): {
        totalTrades: number;
        lowPriceBuys: number;
        hasEnoughData: boolean;
        medianSize: number;
        p90: number;
        p95: number;
        p99: number;
    } {
        const n = this.lowPriceBuys.length;
        const hasEnoughData = n >= this.config.minSamples;

        return {
            totalTrades: this.trades.length,
            lowPriceBuys: n,
            hasEnoughData,
            medianSize: hasEnoughData ? this.lowPriceBuys[Math.floor(n * 0.5)] : 0,
            p90: hasEnoughData ? this.lowPriceBuys[Math.floor(n * 0.9)] : 0,
            p95: hasEnoughData ? this.lowPriceBuys[Math.floor(n * 0.95)] : 0,
            p99: hasEnoughData ? this.lowPriceBuys[Math.floor(n * 0.99)] : 0,
        };
    }

    // ============================================
    // Private helpers for sorted array operations
    // ============================================

    private insertSorted(arr: number[], value: number): void {
        let left = 0;
        let right = arr.length;
        while (left < right) {
            const mid = (left + right) >>> 1;
            if (arr[mid] < value) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        arr.splice(left, 0, value);
    }

    private removeSorted(arr: number[], value: number): void {
        const idx = arr.indexOf(value);
        if (idx !== -1) {
            arr.splice(idx, 1);
        }
    }

    private countSmaller(arr: number[], value: number): number {
        let left = 0;
        let right = arr.length;
        while (left < right) {
            const mid = (left + right) >>> 1;
            if (arr[mid] < value) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        return left;
    }
}

/**
 * Manages statistics for multiple markets
 */
export class MarketStatsManager {
    private markets: Map<string, MarketStats> = new Map();
    private config: PercentileConfig;

    constructor(config: Partial<PercentileConfig> = {}) {
        this.config = { ...DEFAULT_PERCENTILE_CONFIG, ...config };
    }

    /**
     * Get or create stats tracker for a market
     */
    getMarket(marketId: string): MarketStats {
        let stats = this.markets.get(marketId);
        if (!stats) {
            stats = new MarketStats(marketId, this.config);
            this.markets.set(marketId, stats);
        }
        return stats;
    }

    /**
     * Add a trade to the appropriate market
     */
    addTrade(
        marketId: string,
        sizeUsd: number,
        price: number,
        side: 'BUY' | 'SELL',
        timestamp: number = Date.now()
    ): void {
        const stats = this.getMarket(marketId);
        stats.addTrade({ sizeUsd, price, timestamp, side });
    }

    /**
     * Check if a trade is unusual for its market
     */
    checkTrade(
        marketId: string,
        sizeUsd: number,
        price: number,
        side: 'BUY' | 'SELL'
    ): PercentileResult | null {
        const stats = this.getMarket(marketId);
        return stats.shouldAlert(sizeUsd, price, side);
    }

    /**
     * Get stats for all tracked markets
     */
    getAllStats(): Map<string, ReturnType<MarketStats['getStats']>> {
        const result = new Map();
        for (const [marketId, stats] of this.markets) {
            result.set(marketId, stats.getStats());
        }
        return result;
    }
}

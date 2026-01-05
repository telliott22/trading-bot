/**
 * Baseline Calculator
 * Calculates rolling statistics for "normal" market behavior
 * Used to detect anomalies via z-score
 */

import { SmartMoneyTrade, MarketBaseline, DetectionConfig, DEFAULT_CONFIG } from './types';

export class BaselineCalculator {
    private baselines: Map<string, MarketBaseline> = new Map();
    private config: DetectionConfig;

    constructor(config: Partial<DetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Update baseline statistics for a market
     * Should be called periodically with recent trades
     */
    updateBaseline(marketId: string, trades: SmartMoneyTrade[]): void {
        if (trades.length === 0) return;

        const existing = this.baselines.get(marketId);
        const now = Date.now();

        // Filter to window
        const cutoff = now - this.config.baselineWindowMs;
        const windowTrades = trades.filter((t) => t.timestamp >= cutoff);

        if (windowTrades.length === 0) return;

        // Calculate trade sizes
        const tradeSizes = windowTrades.map((t) => t.sizeUsd);
        const avgTradeSize = this.mean(tradeSizes);
        const stdDevTradeSize = this.stdDev(tradeSizes, avgTradeSize);
        const medianTradeSize = this.median(tradeSizes);

        // Calculate volume per hour
        const windowHours = this.config.baselineWindowMs / (60 * 60 * 1000);
        const totalVolume = tradeSizes.reduce((sum, s) => sum + s, 0);
        const avgVolumePerHour = totalVolume / windowHours;

        // Estimate stddev of volume per hour using hourly buckets
        const hourlyVolumes = this.getHourlyVolumes(windowTrades);
        const stdDevVolumePerHour = this.stdDev(hourlyVolumes, avgVolumePerHour);

        // Calculate price changes per hour
        const priceChanges = this.calculateHourlyPriceChanges(windowTrades);
        const avgPriceChangePerHour = this.mean(priceChanges.map(Math.abs));
        const stdDevPriceChangePerHour = this.stdDev(
            priceChanges.map(Math.abs),
            avgPriceChangePerHour
        );

        // Calculate trade frequency
        const avgTradesPerHour = windowTrades.length / windowHours;

        const baseline: MarketBaseline = {
            marketId,
            avgVolumePerHour,
            stdDevVolumePerHour,
            avgTradeSize,
            stdDevTradeSize,
            medianTradeSize,
            avgPriceChangePerHour,
            stdDevPriceChangePerHour,
            avgTradesPerHour,
            updatedAt: now,
            sampleCount: windowTrades.length,
            firstTradeAt: windowTrades[0].timestamp,
            lastTradeAt: windowTrades[windowTrades.length - 1].timestamp,
        };

        this.baselines.set(marketId, baseline);
    }

    /**
     * Get baseline for a market
     */
    getBaseline(marketId: string): MarketBaseline | null {
        return this.baselines.get(marketId) || null;
    }

    /**
     * Check if baseline has enough samples to be reliable
     */
    isBaselineReady(marketId: string): boolean {
        const baseline = this.baselines.get(marketId);
        if (!baseline) return false;
        return baseline.sampleCount >= this.config.minSamplesForBaseline;
    }

    /**
     * Calculate z-score for a trade size
     */
    getTradeSizeZScore(marketId: string, tradeSize: number): number | null {
        const baseline = this.baselines.get(marketId);
        if (!baseline || baseline.stdDevTradeSize === 0) return null;

        return (tradeSize - baseline.avgTradeSize) / baseline.stdDevTradeSize;
    }

    /**
     * Calculate z-score for volume in a window
     */
    getVolumeZScore(marketId: string, observedVolume: number, windowMs: number): number | null {
        const baseline = this.baselines.get(marketId);
        if (!baseline || baseline.stdDevVolumePerHour === 0) return null;

        // Scale expected volume to the window size
        const windowHours = windowMs / (60 * 60 * 1000);
        const expectedVolume = baseline.avgVolumePerHour * windowHours;
        const expectedStdDev = baseline.stdDevVolumePerHour * windowHours;

        return (observedVolume - expectedVolume) / expectedStdDev;
    }

    /**
     * Calculate z-score for price change
     */
    getPriceChangeZScore(marketId: string, priceChange: number): number | null {
        const baseline = this.baselines.get(marketId);
        if (!baseline || baseline.stdDevPriceChangePerHour === 0) return null;

        return (Math.abs(priceChange) - baseline.avgPriceChangePerHour) / baseline.stdDevPriceChangePerHour;
    }

    /**
     * Get expected volume for a time window
     */
    getExpectedVolume(marketId: string, windowMs: number): number | null {
        const baseline = this.baselines.get(marketId);
        if (!baseline) return null;

        const windowHours = windowMs / (60 * 60 * 1000);
        return baseline.avgVolumePerHour * windowHours;
    }

    /**
     * Get volume multiple (observed / expected)
     */
    getVolumeMultiple(marketId: string, observedVolume: number, windowMs: number): number | null {
        const expected = this.getExpectedVolume(marketId, windowMs);
        if (!expected || expected === 0) return null;

        return observedVolume / expected;
    }

    // ============================================
    // Helper Methods
    // ============================================

    private mean(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    private stdDev(values: number[], mean?: number): number {
        if (values.length < 2) return 0;
        const m = mean !== undefined ? mean : this.mean(values);
        const squaredDiffs = values.map((v) => Math.pow(v - m, 2));
        return Math.sqrt(this.mean(squaredDiffs));
    }

    private median(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    private getHourlyVolumes(trades: SmartMoneyTrade[]): number[] {
        if (trades.length === 0) return [];

        const hourBuckets = new Map<number, number>();
        for (const trade of trades) {
            const hourKey = Math.floor(trade.timestamp / (60 * 60 * 1000));
            const current = hourBuckets.get(hourKey) || 0;
            hourBuckets.set(hourKey, current + trade.sizeUsd);
        }

        return Array.from(hourBuckets.values());
    }

    private calculateHourlyPriceChanges(trades: SmartMoneyTrade[]): number[] {
        if (trades.length < 2) return [];

        const hourBuckets = new Map<number, { first: number; last: number }>();
        for (const trade of trades) {
            const hourKey = Math.floor(trade.timestamp / (60 * 60 * 1000));
            const bucket = hourBuckets.get(hourKey);
            if (!bucket) {
                hourBuckets.set(hourKey, { first: trade.price, last: trade.price });
            } else {
                bucket.last = trade.price;
            }
        }

        const changes: number[] = [];
        for (const bucket of hourBuckets.values()) {
            changes.push(bucket.last - bucket.first);
        }

        return changes;
    }

    /**
     * Get stats for debugging
     */
    getStats(): { marketCount: number; readyCount: number } {
        let readyCount = 0;
        for (const marketId of this.baselines.keys()) {
            if (this.isBaselineReady(marketId)) readyCount++;
        }
        return {
            marketCount: this.baselines.size,
            readyCount,
        };
    }
}

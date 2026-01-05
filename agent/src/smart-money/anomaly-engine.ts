/**
 * Anomaly Engine
 * Detection logic for suspicious trading activity
 */

import {
    SmartMoneyTrade,
    MarketInfo,
    Anomaly,
    AnomalySeverity,
    AnomalyType,
    DetectionConfig,
    DEFAULT_CONFIG,
} from './types';
import { TradeStore } from './trade-store';
import { BaselineCalculator } from './baseline';
import { MarketStatsManager, PercentileResult } from './market-stats';

export class AnomalyEngine {
    private config: DetectionConfig;
    private baselineCalc: BaselineCalculator;
    private marketStats: MarketStatsManager;

    constructor(baselineCalc: BaselineCalculator, config: Partial<DetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.baselineCalc = baselineCalc;
        this.marketStats = new MarketStatsManager();
    }

    /**
     * Get the market stats manager for external access
     */
    getMarketStats(): MarketStatsManager {
        return this.marketStats;
    }

    /**
     * Detect if a trade is anomalously large
     */
    detectLargeTrade(trade: SmartMoneyTrade, market: MarketInfo): Anomaly | null {
        const sizeUsd = trade.sizeUsd;

        // Below minimum threshold
        if (sizeUsd < this.config.largeTradeMin) {
            return null;
        }

        // Calculate z-score if baseline is ready
        const zScore = this.baselineCalc.getTradeSizeZScore(trade.marketId, sizeUsd);
        const hasStatisticalSignificance = zScore !== null && zScore >= this.config.zScoreLow;

        // Determine severity
        let severity: AnomalySeverity;
        if (sizeUsd >= this.config.largeTradeCritical) {
            severity = 'CRITICAL';
        } else if (sizeUsd >= this.config.largeTradeHigh) {
            severity = 'HIGH';
        } else if (hasStatisticalSignificance && zScore! >= this.config.zScoreHigh) {
            severity = 'HIGH';
        } else {
            severity = 'MEDIUM';
        }

        // Determine implied direction
        const impliedDirection = trade.side === 'BUY' ? 'YES' : 'NO';

        return {
            type: 'LARGE_TRADE',
            marketId: trade.marketId,
            marketQuestion: market.question,
            severity,
            timestamp: trade.timestamp,
            details: {
                tradeSize: sizeUsd,
                tradeSizeZScore: zScore || undefined,
                zScore: zScore || undefined,
            },
            currentPrice: trade.price,
            impliedDirection,
            triggerTrade: trade,
        };
    }

    /**
     * Detect volume spike (unusually high volume in a short window)
     */
    detectVolumeSpike(
        marketId: string,
        market: MarketInfo,
        tradeStore: TradeStore
    ): Anomaly | null {
        // Check if baseline is ready
        if (!this.baselineCalc.isBaselineReady(marketId)) {
            return null;
        }

        const windowMs = this.config.volumeSpikeWindowMs;
        const recentVolume = tradeStore.getVolumeInWindow(marketId, windowMs);
        const volumeMultiple = this.baselineCalc.getVolumeMultiple(marketId, recentVolume, windowMs);

        if (volumeMultiple === null || volumeMultiple < this.config.volumeSpikeLow) {
            return null;
        }

        // Calculate z-score
        const zScore = this.baselineCalc.getVolumeZScore(marketId, recentVolume, windowMs);

        // Determine severity
        let severity: AnomalySeverity;
        if (volumeMultiple >= this.config.volumeSpikeCritical) {
            severity = 'CRITICAL';
        } else if (volumeMultiple >= this.config.volumeSpikeHigh) {
            severity = 'HIGH';
        } else if (zScore !== null && zScore >= this.config.zScoreHigh) {
            severity = 'HIGH';
        } else {
            severity = 'MEDIUM';
        }

        // Get recent trades to determine direction
        const recentTrades = tradeStore.getRecentTrades(marketId, windowMs);
        const impliedDirection = this.inferDirectionFromTrades(recentTrades);
        const latestPrice = tradeStore.getLatestPrice(marketId);

        const expectedVolume = this.baselineCalc.getExpectedVolume(marketId, windowMs);

        return {
            type: 'VOLUME_SPIKE',
            marketId,
            marketQuestion: market.question,
            severity,
            timestamp: Date.now(),
            details: {
                volumeMultiple,
                windowVolume: recentVolume,
                expectedVolume: expectedVolume || undefined,
                windowMinutes: windowMs / 60000,
                zScore: zScore || undefined,
            },
            currentPrice: latestPrice || 0,
            impliedDirection,
        };
    }

    /**
     * Detect rapid price movement
     */
    detectRapidPriceMove(
        marketId: string,
        market: MarketInfo,
        tradeStore: TradeStore
    ): Anomaly | null {
        const windowMs = this.config.priceWindowMs;
        const priceChange = tradeStore.getPriceChangeInWindow(marketId, windowMs);

        if (!priceChange) {
            return null;
        }

        const absChange = Math.abs(priceChange.changePercent);

        if (absChange < this.config.priceChangeLow) {
            return null;
        }

        // Calculate z-score if baseline is ready
        const zScore = this.baselineCalc.getPriceChangeZScore(marketId, priceChange.change);

        // Determine severity
        let severity: AnomalySeverity;
        if (absChange >= this.config.priceChangeCritical) {
            severity = 'CRITICAL';
        } else if (absChange >= this.config.priceChangeHigh) {
            severity = 'HIGH';
        } else if (zScore !== null && zScore >= this.config.zScoreHigh) {
            severity = 'HIGH';
        } else {
            severity = 'MEDIUM';
        }

        const priceDirection = priceChange.change > 0 ? 'UP' : 'DOWN';
        const impliedDirection = priceDirection === 'UP' ? 'YES' : 'NO';

        return {
            type: 'RAPID_PRICE_MOVE',
            marketId,
            marketQuestion: market.question,
            severity,
            timestamp: Date.now(),
            details: {
                priceChange: priceChange.changePercent,
                priceDirection,
                priceStart: priceChange.start,
                priceEnd: priceChange.end,
                windowMinutes: windowMs / 60000,
                zScore: zScore || undefined,
            },
            currentPrice: priceChange.end,
            impliedDirection,
        };
    }

    /**
     * Detect unusual low-price buy (percentile-based insider signal)
     *
     * This is the KEY detection for insider trading:
     * - Flags BUY trades at low prices (<25%) that are in the top percentiles
     * - A $500 trade at 6% when median is $4 is highly suspicious
     */
    detectUnusualLowPriceBuy(trade: SmartMoneyTrade, market: MarketInfo): Anomaly | null {
        // Only check BUY trades at low prices
        if (trade.side !== 'BUY') {
            return null;
        }

        // First, record the trade to update statistics
        this.marketStats.addTrade(
            trade.marketId,
            trade.sizeUsd,
            trade.price,
            trade.side,
            trade.timestamp
        );

        // Check if this trade is unusual
        const result = this.marketStats.checkTrade(
            trade.marketId,
            trade.sizeUsd,
            trade.price,
            trade.side
        );

        if (!result) {
            return null;
        }

        // Map severity
        let severity: AnomalySeverity;
        switch (result.severity) {
            case 'CRITICAL':
                severity = 'CRITICAL';
                break;
            case 'HIGH':
                severity = 'HIGH';
                break;
            case 'MEDIUM':
                severity = 'MEDIUM';
                break;
            default:
                return null;
        }

        return {
            type: 'UNUSUAL_LOW_PRICE_BUY',
            marketId: trade.marketId,
            marketQuestion: market.question,
            severity,
            timestamp: trade.timestamp,
            details: {
                tradeSize: trade.sizeUsd,
                percentile: result.percentile,
                rank: result.rank,
                totalTrades: result.totalTrades,
                medianSize: result.medianSize,
            },
            currentPrice: trade.price,
            impliedDirection: 'YES', // Low-price BUY implies YES
            triggerTrade: trade,
        };
    }

    /**
     * Run all anomaly checks for a new trade
     * Returns all detected anomalies (may be multiple)
     */
    checkAllAnomalies(
        trade: SmartMoneyTrade,
        market: MarketInfo,
        tradeStore: TradeStore
    ): Anomaly[] {
        const anomalies: Anomaly[] = [];

        // Check unusual low-price buy (percentile-based) - MOST IMPORTANT FOR INSIDER DETECTION
        const unusualBuy = this.detectUnusualLowPriceBuy(trade, market);
        if (unusualBuy) {
            anomalies.push(unusualBuy);
        }

        // Check large trade (absolute threshold)
        const largeTrade = this.detectLargeTrade(trade, market);
        if (largeTrade) {
            anomalies.push(largeTrade);
        }

        // Check volume spike
        const volumeSpike = this.detectVolumeSpike(trade.marketId, market, tradeStore);
        if (volumeSpike) {
            anomalies.push(volumeSpike);
        }

        // Check rapid price move
        const priceMove = this.detectRapidPriceMove(trade.marketId, market, tradeStore);
        if (priceMove) {
            anomalies.push(priceMove);
        }

        return anomalies;
    }

    /**
     * Infer trading direction from a set of trades
     */
    private inferDirectionFromTrades(trades: SmartMoneyTrade[]): 'YES' | 'NO' | 'UNKNOWN' {
        if (trades.length === 0) return 'UNKNOWN';

        let buyVolume = 0;
        let sellVolume = 0;

        for (const trade of trades) {
            if (trade.side === 'BUY') {
                buyVolume += trade.sizeUsd;
            } else {
                sellVolume += trade.sizeUsd;
            }
        }

        if (buyVolume > sellVolume * 1.5) return 'YES';
        if (sellVolume > buyVolume * 1.5) return 'NO';
        return 'UNKNOWN';
    }

    /**
     * Check if an anomaly meets minimum severity threshold
     */
    meetsMinSeverity(anomaly: Anomaly): boolean {
        const severityOrder: AnomalySeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const anomalyIndex = severityOrder.indexOf(anomaly.severity);
        const minIndex = severityOrder.indexOf(this.config.minSeverity);
        return anomalyIndex >= minIndex;
    }
}

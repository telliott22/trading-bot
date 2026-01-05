/**
 * Backtest Evaluator
 * Replays historical trades through the anomaly detection system
 * and evaluates detection accuracy
 */

import {
    SmartMoneyTrade,
    MarketInfo,
    Anomaly,
    DetectionConfig,
    DEFAULT_CONFIG,
} from '../smart-money/types';
import { TradeStore } from '../smart-money/trade-store';
import { BaselineCalculator } from '../smart-money/baseline';
import { AnomalyEngine } from '../smart-money/anomaly-engine';

export interface AnomalyWithOutcome extends Anomaly {
    // What happened after the anomaly
    priceAfter1h?: number;
    priceAfter24h?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    // Was the implied direction correct?
    directionCorrect?: boolean;
    // Profit if we had traded
    hypotheticalProfit?: number;
}

export interface BacktestResult {
    marketId: string;
    marketQuestion: string;
    // Input data
    totalTrades: number;
    dateRange: { start: Date; end: Date };
    // Detected anomalies
    anomalies: AnomalyWithOutcome[];
    anomaliesByType: {
        LARGE_TRADE: number;
        VOLUME_SPIKE: number;
        RAPID_PRICE_MOVE: number;
        UNUSUAL_LOW_PRICE_BUY: number;
    };
    // Evaluation metrics
    precision: number; // % of alerts that led to profitable moves
    avgPriceChangeAfterAlert: number;
    profitableAlerts: number;
    unprofitableAlerts: number;
}

export class BacktestEvaluator {
    private config: DetectionConfig;

    constructor(config: Partial<DetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Run backtest on historical trades for a market
     */
    async evaluateMarket(
        market: MarketInfo,
        historicalTrades: SmartMoneyTrade[]
    ): Promise<BacktestResult> {
        if (historicalTrades.length === 0) {
            return this.emptyResult(market);
        }

        // Sort trades by timestamp
        const trades = [...historicalTrades].sort((a, b) => a.timestamp - b.timestamp);

        // Initialize detection components
        const tradeStore = new TradeStore(this.config.baselineWindowMs);
        const baselineCalc = new BaselineCalculator(this.config);
        const anomalyEngine = new AnomalyEngine(baselineCalc, this.config);

        // Detected anomalies
        const detectedAnomalies: AnomalyWithOutcome[] = [];

        // Build initial baseline from first 25% of trades (warmup period)
        const warmupCount = Math.floor(trades.length * 0.25);
        const warmupTrades = trades.slice(0, warmupCount);
        const testTrades = trades.slice(warmupCount);

        for (const trade of warmupTrades) {
            tradeStore.addTrade(trade);
        }
        baselineCalc.updateBaseline(market.id, warmupTrades);

        console.log(`  Warmup: ${warmupCount} trades, Test: ${testTrades.length} trades`);

        // Track max price change for debugging
        let maxPriceChange = 0;
        let maxTradeSize = 0;

        // Process test trades
        for (const trade of testTrades) {
            // Set simulated time to the trade's timestamp for proper window calculations
            tradeStore.setSimulatedTime(trade.timestamp);
            tradeStore.addTrade(trade);

            // Track max values for debugging
            if (trade.sizeUsd > maxTradeSize) {
                maxTradeSize = trade.sizeUsd;
            }
            const priceChange = tradeStore.getPriceChangeInWindow(market.id, this.config.priceWindowMs);
            if (priceChange && Math.abs(priceChange.changePercent) > maxPriceChange) {
                maxPriceChange = Math.abs(priceChange.changePercent);
            }

            // Run anomaly detection
            const anomalies = anomalyEngine.checkAllAnomalies(trade, market, tradeStore);

            for (const anomaly of anomalies) {
                if (anomalyEngine.meetsMinSeverity(anomaly)) {
                    // Enrich with outcome data
                    const enriched = this.enrichAnomalyWithOutcome(anomaly, trades);
                    detectedAnomalies.push(enriched);
                }
            }

            // Update baseline (skip anomalous trades to prevent drift)
            if (anomalies.length === 0) {
                baselineCalc.updateBaseline(market.id, [trade]);
            }
        }

        console.log(`  Max trade size: $${maxTradeSize.toFixed(2)}`);
        console.log(`  Max 5-min price change: ${(maxPriceChange * 100).toFixed(2)}%`);

        // Calculate metrics
        return this.calculateMetrics(market, trades, detectedAnomalies);
    }

    /**
     * Enrich anomaly with outcome data (what happened after)
     */
    private enrichAnomalyWithOutcome(
        anomaly: Anomaly,
        allTrades: SmartMoneyTrade[]
    ): AnomalyWithOutcome {
        const timestamp = anomaly.timestamp;
        const oneHourLater = timestamp + 60 * 60 * 1000;
        const oneDayLater = timestamp + 24 * 60 * 60 * 1000;

        // Find prices at future times
        const trade1h = allTrades.find((t) => t.timestamp >= oneHourLater);
        const trade24h = allTrades.find((t) => t.timestamp >= oneDayLater);

        const priceAfter1h = trade1h?.price;
        const priceAfter24h = trade24h?.price;

        const priceChange1h = priceAfter1h !== undefined
            ? priceAfter1h - anomaly.currentPrice
            : undefined;
        const priceChange24h = priceAfter24h !== undefined
            ? priceAfter24h - anomaly.currentPrice
            : undefined;

        // Was the implied direction correct?
        let directionCorrect: boolean | undefined;
        if (priceChange24h !== undefined && anomaly.impliedDirection !== 'UNKNOWN') {
            if (anomaly.impliedDirection === 'YES') {
                directionCorrect = priceChange24h > 0;
            } else {
                directionCorrect = priceChange24h < 0;
            }
        }

        // Calculate hypothetical profit
        // Assume: Buy at current price, sell at 24h price (or current if not available)
        let hypotheticalProfit: number | undefined;
        if (priceChange24h !== undefined) {
            // If we bet $100 on the implied direction
            const betAmount = 100;
            if (anomaly.impliedDirection === 'YES') {
                // Buy YES at currentPrice, value changes by priceChange24h
                hypotheticalProfit = betAmount * (priceChange24h / anomaly.currentPrice);
            } else if (anomaly.impliedDirection === 'NO') {
                // Buy NO at (1 - currentPrice), NO price = 1 - YES price
                const noPrice = 1 - anomaly.currentPrice;
                const noPriceChange = -priceChange24h; // NO moves opposite to YES
                hypotheticalProfit = betAmount * (noPriceChange / noPrice);
            }
        }

        return {
            ...anomaly,
            priceAfter1h,
            priceAfter24h,
            priceChange1h,
            priceChange24h,
            directionCorrect,
            hypotheticalProfit,
        };
    }

    /**
     * Calculate evaluation metrics
     */
    private calculateMetrics(
        market: MarketInfo,
        trades: SmartMoneyTrade[],
        anomalies: AnomalyWithOutcome[]
    ): BacktestResult {
        const byType = {
            LARGE_TRADE: 0,
            VOLUME_SPIKE: 0,
            RAPID_PRICE_MOVE: 0,
            UNUSUAL_LOW_PRICE_BUY: 0,
        };

        let profitableAlerts = 0;
        let unprofitableAlerts = 0;
        let totalPriceChangeAfterAlert = 0;
        let alertsWithOutcome = 0;

        for (const anomaly of anomalies) {
            byType[anomaly.type]++;

            if (anomaly.directionCorrect !== undefined) {
                if (anomaly.directionCorrect) {
                    profitableAlerts++;
                } else {
                    unprofitableAlerts++;
                }
            }

            if (anomaly.priceChange24h !== undefined) {
                totalPriceChangeAfterAlert += Math.abs(anomaly.priceChange24h);
                alertsWithOutcome++;
            }
        }

        const precision =
            profitableAlerts + unprofitableAlerts > 0
                ? profitableAlerts / (profitableAlerts + unprofitableAlerts)
                : 0;

        const avgPriceChangeAfterAlert =
            alertsWithOutcome > 0 ? totalPriceChangeAfterAlert / alertsWithOutcome : 0;

        return {
            marketId: market.id,
            marketQuestion: market.question,
            totalTrades: trades.length,
            dateRange: {
                start: new Date(trades[0].timestamp),
                end: new Date(trades[trades.length - 1].timestamp),
            },
            anomalies,
            anomaliesByType: byType,
            precision,
            avgPriceChangeAfterAlert,
            profitableAlerts,
            unprofitableAlerts,
        };
    }

    private emptyResult(market: MarketInfo): BacktestResult {
        return {
            marketId: market.id,
            marketQuestion: market.question,
            totalTrades: 0,
            dateRange: { start: new Date(), end: new Date() },
            anomalies: [],
            anomaliesByType: {
                LARGE_TRADE: 0,
                VOLUME_SPIKE: 0,
                RAPID_PRICE_MOVE: 0,
                UNUSUAL_LOW_PRICE_BUY: 0,
            },
            precision: 0,
            avgPriceChangeAfterAlert: 0,
            profitableAlerts: 0,
            unprofitableAlerts: 0,
        };
    }
}

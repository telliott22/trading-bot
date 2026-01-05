/**
 * Smart Money Detection Types
 * Types for detecting suspicious trading activity on Polymarket
 */

// ============================================
// Trade Types
// ============================================

export interface SmartMoneyTrade {
    marketId: string;
    conditionId: string; // Market condition ID
    tokenId: string; // YES/NO token ID
    price: number; // 0.0 to 1.0
    size: number; // Number of shares
    sizeUsd: number; // USD value (size * price)
    side: 'BUY' | 'SELL';
    timestamp: number; // Unix ms
    makerAddress?: string;
    takerAddress?: string;
}

export interface MarketInfo {
    id: string;
    conditionId: string;
    slug?: string;
    question: string;
    description?: string;
    endDate: string;
    yesTokenId: string;
    noTokenId: string;
    currentYesPrice?: number;
    currentNoPrice?: number;
    volume24h?: number;
}

// ============================================
// Baseline Types
// ============================================

export interface MarketBaseline {
    marketId: string;
    // Volume metrics (rolling 24h)
    avgVolumePerHour: number;
    stdDevVolumePerHour: number;
    // Trade size metrics
    avgTradeSize: number;
    stdDevTradeSize: number;
    medianTradeSize: number;
    // Price volatility
    avgPriceChangePerHour: number;
    stdDevPriceChangePerHour: number;
    // Trade frequency
    avgTradesPerHour: number;
    // Metadata
    updatedAt: number;
    sampleCount: number;
    firstTradeAt: number;
    lastTradeAt: number;
}

// ============================================
// Anomaly Types
// ============================================

export type AnomalyType =
    | 'LARGE_TRADE' // Single trade > threshold
    | 'VOLUME_SPIKE' // 10x normal volume in window
    | 'RAPID_PRICE_MOVE' // >10% in 5 minutes
    | 'UNUSUAL_LOW_PRICE_BUY'; // Trade in top percentile at low price (insider signal)

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AnomalyDetails {
    // For LARGE_TRADE
    tradeSize?: number;
    tradeSizeZScore?: number;
    // For VOLUME_SPIKE
    volumeMultiple?: number; // e.g., 15 = "15x normal"
    windowVolume?: number;
    expectedVolume?: number;
    // For RAPID_PRICE_MOVE
    priceChange?: number; // e.g., 0.15 = 15%
    priceDirection?: 'UP' | 'DOWN';
    priceStart?: number;
    priceEnd?: number;
    // For UNUSUAL_LOW_PRICE_BUY (percentile-based)
    percentile?: number; // e.g., 0.98 = 98th percentile
    rank?: number; // e.g., 3 = "3rd largest"
    totalTrades?: number; // e.g., 500 = "of 500 trades"
    medianSize?: number; // For context
    // Common
    windowMinutes?: number;
    zScore?: number;
}

export interface Anomaly {
    type: AnomalyType;
    marketId: string;
    marketQuestion: string;
    severity: AnomalySeverity;
    timestamp: number;
    details: AnomalyDetails;
    // Context for trading decision
    currentPrice: number;
    impliedDirection: 'YES' | 'NO' | 'UNKNOWN';
    // For linking to the triggering trade
    triggerTrade?: SmartMoneyTrade;
}

// ============================================
// Configuration Types
// ============================================

export interface DetectionConfig {
    // Large trade thresholds (USD)
    largeTradeMin: number; // $5k minimum to consider
    largeTradeHigh: number; // $10k = HIGH severity
    largeTradeCritical: number; // $25k = CRITICAL

    // Volume spike (multiple of baseline)
    volumeSpikeWindowMs: number; // 5 minutes
    volumeSpikeLow: number; // 5x normal
    volumeSpikeHigh: number; // 10x normal
    volumeSpikeCritical: number; // 20x normal

    // Rapid price movement
    priceWindowMs: number; // 5 minutes
    priceChangeLow: number; // 5%
    priceChangeHigh: number; // 10%
    priceChangeCritical: number; // 20%

    // Z-score thresholds (standard deviations)
    zScoreLow: number;
    zScoreHigh: number;
    zScoreCritical: number;

    // Baseline settings
    baselineWindowMs: number; // 24h
    minSamplesForBaseline: number; // 100 trades

    // Alert settings
    alertCooldownMs: number; // 5 min
    maxAlertsPerHour: number;
    minSeverity: AnomalySeverity;
}

export const DEFAULT_CONFIG: DetectionConfig = {
    // Large trade thresholds
    largeTradeMin: 5000,
    largeTradeHigh: 10000,
    largeTradeCritical: 25000,

    // Volume spike
    volumeSpikeWindowMs: 5 * 60 * 1000,
    volumeSpikeLow: 5,
    volumeSpikeHigh: 10,
    volumeSpikeCritical: 20,

    // Price movement
    priceWindowMs: 5 * 60 * 1000,
    priceChangeLow: 0.05,
    priceChangeHigh: 0.10,
    priceChangeCritical: 0.20,

    // Z-scores
    zScoreLow: 2,
    zScoreHigh: 3,
    zScoreCritical: 4,

    // Baseline
    baselineWindowMs: 24 * 60 * 60 * 1000,
    minSamplesForBaseline: 100,

    // Alerts
    alertCooldownMs: 5 * 60 * 1000,
    maxAlertsPerHour: 20,
    minSeverity: 'MEDIUM',
};

// ============================================
// WebSocket Types (Polymarket CLOB)
// ============================================

export interface WsTradeEvent {
    event_type: 'last_trade_price';
    asset_id: string;
    market: string; // condition ID
    price: string;
    size: string;
    side: 'BUY' | 'SELL';
    fee_rate_bps: number;
    timestamp: string;
}

export interface WsPriceChangeEvent {
    event_type: 'price_change';
    asset_id: string;
    market: string;
    price: string;
    timestamp: string;
}

export type WsMarketEvent = WsTradeEvent | WsPriceChangeEvent;

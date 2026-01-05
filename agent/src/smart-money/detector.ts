/**
 * Smart Money Detector
 * Main orchestrator for detecting suspicious trading activity
 */

import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config();

import { Notifier } from '../notifications';
import {
    SmartMoneyTrade,
    MarketInfo,
    WsTradeEvent,
    DetectionConfig,
    DEFAULT_CONFIG,
} from './types';
import { TradeStore } from './trade-store';
import { BaselineCalculator } from './baseline';
import { AnomalyEngine } from './anomaly-engine';
import { MarketFilter } from './market-filter';
import { AlertManager } from './alerts';
import { TradeRecorder } from './trade-recorder';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export class SmartMoneyDetector {
    private ws: WebSocket | null = null;
    private tradeStore: TradeStore;
    private baselineCalc: BaselineCalculator;
    private anomalyEngine: AnomalyEngine;
    private marketFilter: MarketFilter;
    private alertManager: AlertManager;
    private tradeRecorder: TradeRecorder;
    private config: DetectionConfig;

    // Market tracking
    private monitoredMarkets: Map<string, MarketInfo> = new Map();
    private tokenToMarket: Map<string, string> = new Map(); // tokenId -> marketId
    private running: boolean = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;

    constructor(notifier: Notifier, config: Partial<DetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.tradeStore = new TradeStore(this.config.baselineWindowMs);
        this.baselineCalc = new BaselineCalculator(this.config);
        this.anomalyEngine = new AnomalyEngine(this.baselineCalc, this.config);
        this.marketFilter = new MarketFilter();
        this.alertManager = new AlertManager(notifier, this.config);
        this.tradeRecorder = new TradeRecorder();
    }

    /**
     * Get the alert store for external access (e.g., health server)
     */
    getAlertStore() {
        return this.alertManager.getAlertStore();
    }

    /**
     * Start the detector
     */
    async start(): Promise<void> {
        console.log('Starting Smart Money Detector...');
        console.log('================================');
        console.log(`Config:`);
        console.log(`  Large trade min: $${this.config.largeTradeMin.toLocaleString()}`);
        console.log(`  Volume spike threshold: ${this.config.volumeSpikeHigh}x`);
        console.log(`  Price change threshold: ${(this.config.priceChangeHigh * 100).toFixed(0)}%`);
        console.log(`  Min severity: ${this.config.minSeverity}`);
        console.log('');

        this.running = true;

        // 1. Fetch active markets
        console.log('Fetching active markets...');
        const markets = await this.fetchActiveMarkets();
        console.log(`Found ${markets.length} active markets`);

        // 2. Filter to insider-plausible markets
        const filtered = this.marketFilter.filterMarkets(markets);
        console.log(`Filtered to ${filtered.length} insider-plausible markets`);

        if (filtered.length === 0) {
            console.log('No insider-plausible markets found. Exiting.');
            return;
        }

        // Store markets
        for (const market of filtered) {
            this.monitoredMarkets.set(market.id, market);
            this.tokenToMarket.set(market.yesTokenId, market.id);
            this.tokenToMarket.set(market.noTokenId, market.id);
        }

        // 3. Warm up baselines with historical data
        await this.warmUpBaselines(filtered);

        // 4. Connect WebSocket and subscribe
        await this.connectWebSocket();

        // 5. Start periodic cleanup
        this.startPeriodicTasks();

        console.log('\nSmart Money Detector running.');
        console.log('Monitoring for suspicious activity...\n');
    }

    /**
     * Stop the detector
     */
    stop(): void {
        console.log('Stopping Smart Money Detector...');
        this.running = false;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Close trade recorder
        console.log(`Recorded ${this.tradeRecorder.getCount()} trades this session`);
        this.tradeRecorder.close();
    }

    /**
     * Fetch active markets from Polymarket
     */
    private async fetchActiveMarkets(): Promise<MarketInfo[]> {
        const markets: MarketInfo[] = [];
        let offset = 0;
        const limit = 100;
        const maxPages = 10;

        try {
            for (let i = 0; i < maxPages; i++) {
                const url = `${GAMMA_API}/events?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
                const response = await fetch(url);
                const events = await response.json();

                if (!Array.isArray(events) || events.length === 0) break;

                for (const event of events) {
                    if (!event.markets || !Array.isArray(event.markets)) continue;

                    for (const m of event.markets) {
                        // Skip closed markets
                        if (m.closed) continue;

                        // Token IDs are in clobTokenIds as JSON string: ["yesId", "noId"]
                        let tokenIds: string[] = [];
                        try {
                            if (m.clobTokenIds) {
                                tokenIds = JSON.parse(m.clobTokenIds);
                            }
                        } catch {
                            continue;
                        }

                        if (tokenIds.length < 2) continue;

                        // Parse prices from outcomePrices JSON string: ["0.45", "0.55"]
                        let prices: number[] = [];
                        try {
                            if (m.outcomePrices) {
                                prices = JSON.parse(m.outcomePrices).map((p: string) => parseFloat(p));
                            }
                        } catch {
                            // Prices optional
                        }

                        markets.push({
                            id: m.id,
                            conditionId: m.conditionId || m.id,
                            slug: event.slug || m.slug,
                            question: m.question,
                            description: m.description || event.description,
                            endDate: m.endDate,
                            yesTokenId: tokenIds[0],
                            noTokenId: tokenIds[1],
                            currentYesPrice: prices[0],
                            currentNoPrice: prices[1],
                            volume24h: parseFloat(m.volume24hr || m.volume || '0'),
                        });
                    }
                }

                offset += limit;
                if (markets.length >= 500) break; // Reasonable limit
            }
        } catch (error) {
            console.error('Error fetching markets:', error);
        }

        return markets;
    }

    /**
     * Warm up baselines
     * Note: CLOB API requires auth for historical trades, so we skip that
     * and rely on building baselines from real-time data instead.
     * Large trades (above absolute threshold) still get alerted immediately.
     */
    private async warmUpBaselines(markets: MarketInfo[]): Promise<void> {
        console.log('\nNote: Building baselines from real-time data (historical API requires auth)');
        console.log('Large trades (>$5k) will alert immediately; statistical anomalies need ~100 trades for baseline.\n');
    }

    /**
     * Fetch historical trades for a market
     */
    private async fetchHistoricalTrades(
        marketId: string,
        hoursBack: number
    ): Promise<SmartMoneyTrade[]> {
        const trades: SmartMoneyTrade[] = [];
        const now = Date.now();
        const startTime = now - hoursBack * 60 * 60 * 1000;

        try {
            // Use the CLOB API to fetch trades
            // Note: The exact endpoint may vary - this is based on documented API
            const url = `${CLOB_API}/trades?market=${marketId}&after=${Math.floor(startTime / 1000)}`;
            const response = await fetch(url);

            if (!response.ok) {
                return [];
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                return [];
            }

            for (const t of data) {
                trades.push({
                    marketId,
                    conditionId: t.market || marketId,
                    tokenId: t.asset_id || '',
                    price: parseFloat(t.price || '0'),
                    size: parseFloat(t.size || '0'),
                    sizeUsd: parseFloat(t.price || '0') * parseFloat(t.size || '0'),
                    side: t.side?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
                    timestamp: new Date(t.timestamp || t.created_at).getTime(),
                    makerAddress: t.maker_address,
                    takerAddress: t.taker_address,
                });
            }
        } catch (error) {
            // Silently fail - historical data is optional
        }

        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Connect to Polymarket WebSocket
     */
    private async connectWebSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log('\nConnecting to Polymarket WebSocket...');

            this.ws = new WebSocket(WS_URL);

            this.ws.on('open', () => {
                console.log('Connected to Polymarket WebSocket');

                // Get all token IDs to subscribe to
                const tokenIds: string[] = [];
                for (const market of this.monitoredMarkets.values()) {
                    tokenIds.push(market.yesTokenId);
                    tokenIds.push(market.noTokenId);
                }

                console.log(`Subscribing to ${tokenIds.length} tokens (${this.monitoredMarkets.size} markets)...`);

                // Subscribe in batches to avoid message size limits
                const batchSize = 100;
                for (let i = 0; i < tokenIds.length; i += batchSize) {
                    const batch = tokenIds.slice(i, i + batchSize);
                    const subscription = {
                        type: 'subscribe',
                        channel: 'market',
                        assets_ids: batch,
                    };
                    this.ws?.send(JSON.stringify(subscription));
                }

                console.log('Subscribed to market updates');
                resolve();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                this.handleWsMessage(data);
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });

            this.ws.on('close', () => {
                console.log('WebSocket closed');
                if (this.running) {
                    console.log('Reconnecting in 5 seconds...');
                    this.reconnectTimeout = setTimeout(() => {
                        this.connectWebSocket();
                    }, 5000);
                }
            });

            // Timeout if connection takes too long
            setTimeout(() => {
                if (this.ws?.readyState !== WebSocket.OPEN) {
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Handle incoming WebSocket message
     */
    private handleWsMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());

            // Handle different event types
            if (message.event_type === 'last_trade_price' || message.type === 'trade') {
                this.handleTradeEvent(message);
            } else if (Array.isArray(message)) {
                // Some APIs send arrays of events
                for (const event of message) {
                    if (event.event_type === 'last_trade_price' || event.type === 'trade') {
                        this.handleTradeEvent(event);
                    }
                }
            }
        } catch (error) {
            // Ignore parse errors for non-JSON messages (like pings)
        }
    }

    /**
     * Handle a trade event from WebSocket
     */
    private handleTradeEvent(event: any): void {
        // Get market ID from token
        const tokenId = event.asset_id || event.token_id;
        const marketId = this.tokenToMarket.get(tokenId);

        if (!marketId) {
            return; // Not a market we're monitoring
        }

        const market = this.monitoredMarkets.get(marketId);
        if (!market) {
            return;
        }

        // Parse trade
        const trade: SmartMoneyTrade = {
            marketId,
            conditionId: event.market || event.condition_id || marketId,
            tokenId,
            price: parseFloat(event.price || '0'),
            size: parseFloat(event.size || '0'),
            sizeUsd: parseFloat(event.price || '0') * parseFloat(event.size || '0'),
            side: (event.side?.toUpperCase() || 'BUY') as 'BUY' | 'SELL',
            timestamp: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
        };

        // Store the trade
        this.tradeStore.addTrade(trade);

        // Record for future backtesting
        this.tradeRecorder.record(trade);

        // Run anomaly detection
        this.checkAnomalies(trade, market);

        // Update baseline (but only for non-anomalous trades)
        // This is handled in checkAnomalies to exclude anomalies from baseline
    }

    /**
     * Check for anomalies and send alerts
     */
    private async checkAnomalies(trade: SmartMoneyTrade, market: MarketInfo): Promise<void> {
        const anomalies = this.anomalyEngine.checkAllAnomalies(trade, market, this.tradeStore);

        let hasAnomaly = false;

        for (const anomaly of anomalies) {
            // Check if it meets minimum severity
            if (!this.anomalyEngine.meetsMinSeverity(anomaly)) {
                continue;
            }

            hasAnomaly = true;

            // Log it
            console.log(
                `[${new Date().toISOString()}] ${anomaly.severity} ${anomaly.type}: ${market.question.slice(0, 50)}... - $${trade.sizeUsd.toFixed(0)}`
            );

            // Send alert
            await this.alertManager.sendAnomalyAlert(anomaly, market);
        }

        // Only update baseline if no anomalies (prevents baseline drift)
        if (!hasAnomaly) {
            this.baselineCalc.updateBaseline(trade.marketId, [trade]);
        }
    }

    /**
     * Start periodic cleanup and stats
     */
    private startPeriodicTasks(): void {
        // Cleanup old data every hour
        setInterval(() => {
            this.tradeStore.cleanup();
        }, 60 * 60 * 1000);

        // Log stats every 5 minutes
        setInterval(() => {
            const tradeStats = this.tradeStore.getStats();
            const baselineStats = this.baselineCalc.getStats();
            const alertStats = this.alertManager.getStats();

            console.log(
                `[Stats] Markets: ${tradeStats.marketCount}, Trades: ${tradeStats.totalTrades}, ` +
                    `Baselines ready: ${baselineStats.readyCount}, Alerts this hour: ${alertStats.alertsThisHour}`
            );
        }, 5 * 60 * 1000);

        // Refresh markets every 30 minutes to catch new markets
        setInterval(() => {
            this.refreshMarkets();
        }, 30 * 60 * 1000);

        // Push alerts to GitHub every hour
        setInterval(() => {
            this.alertManager.pushAlerts();
        }, 60 * 60 * 1000);
    }

    /**
     * Refresh markets to catch newly created ones
     */
    private async refreshMarkets(): Promise<void> {
        try {
            console.log('[Refresh] Checking for new markets...');
            const markets = await this.fetchActiveMarkets();
            const filtered = this.marketFilter.filterMarkets(markets);

            let newMarkets = 0;
            const newTokenIds: string[] = [];

            for (const market of filtered) {
                if (!this.monitoredMarkets.has(market.id)) {
                    // New market found
                    this.monitoredMarkets.set(market.id, market);
                    this.tokenToMarket.set(market.yesTokenId, market.id);
                    this.tokenToMarket.set(market.noTokenId, market.id);
                    newTokenIds.push(market.yesTokenId);
                    newTokenIds.push(market.noTokenId);
                    newMarkets++;
                }
            }

            if (newMarkets > 0 && this.ws?.readyState === WebSocket.OPEN) {
                // Subscribe to new tokens
                const batchSize = 100;
                for (let i = 0; i < newTokenIds.length; i += batchSize) {
                    const batch = newTokenIds.slice(i, i + batchSize);
                    const subscription = {
                        type: 'subscribe',
                        channel: 'market',
                        assets_ids: batch,
                    };
                    this.ws.send(JSON.stringify(subscription));
                }
                console.log(`[Refresh] Added ${newMarkets} new markets (${this.monitoredMarkets.size} total)`);
            } else {
                console.log(`[Refresh] No new markets found (${this.monitoredMarkets.size} total)`);
            }
        } catch (error) {
            console.error('[Refresh] Error refreshing markets:', error);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Get detector stats for debugging
     */
    getStats(): {
        markets: number;
        trades: number;
        baselinesReady: number;
        alertsThisHour: number;
    } {
        const tradeStats = this.tradeStore.getStats();
        const baselineStats = this.baselineCalc.getStats();
        const alertStats = this.alertManager.getStats();

        return {
            markets: tradeStats.marketCount,
            trades: tradeStats.totalTrades,
            baselinesReady: baselineStats.readyCount,
            alertsThisHour: alertStats.alertsThisHour,
        };
    }
}

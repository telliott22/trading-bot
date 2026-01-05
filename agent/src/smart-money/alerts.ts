/**
 * Alert Manager
 * Formats and sends anomaly alerts via Telegram
 * Handles deduplication and rate limiting
 */

import { Notifier } from '../notifications';
import { Anomaly, AnomalySeverity, MarketInfo, DetectionConfig, DEFAULT_CONFIG } from './types';
import { AlertStore } from './alert-store';

interface AlertRecord {
    anomalyType: string;
    marketId: string;
    timestamp: number;
}

export class AlertManager {
    private notifier: Notifier;
    private config: DetectionConfig;
    private recentAlerts: Map<string, number> = new Map(); // key -> lastAlertTime
    private alertCount: number = 0;
    private alertCountResetTime: number = Date.now();
    private alertStore: AlertStore;

    constructor(notifier: Notifier, config: Partial<DetectionConfig> = {}) {
        this.notifier = notifier;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.alertStore = new AlertStore();
    }

    /**
     * Get the alert store for external access
     */
    getAlertStore(): AlertStore {
        return this.alertStore;
    }

    /**
     * Send an anomaly alert if it passes rate limiting and deduplication
     */
    async sendAnomalyAlert(anomaly: Anomaly, market: MarketInfo): Promise<boolean> {
        // Check cooldown for this market + anomaly type
        const key = `${anomaly.marketId}:${anomaly.type}`;
        const lastAlert = this.recentAlerts.get(key);
        if (lastAlert && Date.now() - lastAlert < this.config.alertCooldownMs) {
            console.log(`Skipping alert (cooldown): ${anomaly.type} for ${market.question.slice(0, 50)}...`);
            return false;
        }

        // Check hourly rate limit
        this.resetAlertCountIfNeeded();
        if (this.alertCount >= this.config.maxAlertsPerHour) {
            console.log(`Skipping alert (rate limit): ${this.alertCount}/${this.config.maxAlertsPerHour} alerts this hour`);
            return false;
        }

        // Format and send
        const message = this.formatAlert(anomaly, market);

        try {
            // Use the raw send method to avoid the info emoji prefix
            await this.sendRaw(message);

            // Store alert in JSON file
            this.alertStore.addAlert(anomaly);

            // Update tracking
            this.recentAlerts.set(key, Date.now());
            this.alertCount++;

            console.log(`Alert sent: ${anomaly.type} (${anomaly.severity}) for ${market.question.slice(0, 50)}...`);
            return true;
        } catch (error) {
            console.error('Failed to send alert:', error);
            return false;
        }
    }

    /**
     * Push alerts to GitHub (call periodically)
     */
    async pushAlerts(): Promise<void> {
        await this.alertStore.pushToGitHub();
    }

    /**
     * Format alert message based on anomaly type
     */
    private formatAlert(anomaly: Anomaly, market: MarketInfo): string {
        const emoji = this.getSeverityEmoji(anomaly.severity);
        const direction = anomaly.impliedDirection === 'YES' ? 'UP' : anomaly.impliedDirection === 'NO' ? 'DOWN' : '?';
        const pricePercent = (anomaly.currentPrice * 100).toFixed(1);
        const marketUrl = market.slug ? `https://polymarket.com/event/${market.slug}` : '';

        switch (anomaly.type) {
            case 'LARGE_TRADE':
                return this.formatLargeTradeAlert(anomaly, market, emoji, direction, pricePercent, marketUrl);

            case 'VOLUME_SPIKE':
                return this.formatVolumeSpikeAlert(anomaly, market, emoji, direction, pricePercent, marketUrl);

            case 'RAPID_PRICE_MOVE':
                return this.formatPriceMoveAlert(anomaly, market, emoji, pricePercent, marketUrl);

            case 'UNUSUAL_LOW_PRICE_BUY':
                return this.formatUnusualLowPriceBuyAlert(anomaly, market, emoji, pricePercent, marketUrl);

            default:
                return `${emoji} ANOMALY DETECTED

Market: ${market.question}
Type: ${anomaly.type}
Severity: ${anomaly.severity}

${marketUrl}`;
        }
    }

    private formatLargeTradeAlert(
        anomaly: Anomaly,
        market: MarketInfo,
        emoji: string,
        direction: string,
        pricePercent: string,
        marketUrl: string
    ): string {
        const tradeSize = anomaly.details.tradeSize || 0;
        const zScoreInfo = anomaly.details.tradeSizeZScore
            ? `\nZ-score: ${anomaly.details.tradeSizeZScore.toFixed(1)} std devs`
            : '';

        return `${emoji} WHALE TRADE - $${tradeSize.toLocaleString()}

${market.question}

Direction: ${direction}
Current YES: ${pricePercent}%${zScoreInfo}

Someone just placed a large bet. Could be informed money.

${marketUrl ? `Trade: ${marketUrl}` : ''}`;
    }

    private formatVolumeSpikeAlert(
        anomaly: Anomaly,
        market: MarketInfo,
        emoji: string,
        direction: string,
        pricePercent: string,
        marketUrl: string
    ): string {
        const multiple = anomaly.details.volumeMultiple || 0;
        const windowMins = anomaly.details.windowMinutes || 5;
        const windowVolume = anomaly.details.windowVolume || 0;

        return `${emoji} VOLUME SPIKE - ${multiple.toFixed(1)}x normal

${market.question}

${windowMins} min volume: $${windowVolume.toLocaleString()}
Direction: ${direction}
Current YES: ${pricePercent}%

Unusual activity detected. Something may be happening.

${marketUrl ? `Trade: ${marketUrl}` : ''}`;
    }

    private formatPriceMoveAlert(
        anomaly: Anomaly,
        market: MarketInfo,
        emoji: string,
        pricePercent: string,
        marketUrl: string
    ): string {
        const change = anomaly.details.priceChange || 0;
        const changePercent = (change * 100).toFixed(1);
        const direction = anomaly.details.priceDirection || 'UNKNOWN';
        const windowMins = anomaly.details.windowMinutes || 5;
        const priceStart = anomaly.details.priceStart || 0;
        const priceEnd = anomaly.details.priceEnd || 0;

        return `${emoji} PRICE MOVE - ${direction} ${Math.abs(parseFloat(changePercent))}%

${market.question}

${windowMins} min: ${(priceStart * 100).toFixed(1)}% -> ${(priceEnd * 100).toFixed(1)}%
Current YES: ${pricePercent}%

Rapid price movement without obvious news. Worth investigating.

${marketUrl ? `Trade: ${marketUrl}` : ''}`;
    }

    private formatUnusualLowPriceBuyAlert(
        anomaly: Anomaly,
        market: MarketInfo,
        emoji: string,
        pricePercent: string,
        marketUrl: string
    ): string {
        const tradeSize = anomaly.details.tradeSize || 0;
        const percentile = anomaly.details.percentile || 0;
        const rank = anomaly.details.rank || 0;
        const totalTrades = anomaly.details.totalTrades || 0;
        const medianSize = anomaly.details.medianSize || 0;

        const percentileStr = (percentile * 100).toFixed(1);
        const multiplier = medianSize > 0 ? (tradeSize / medianSize).toFixed(0) : '?';

        return `${emoji} INSIDER SIGNAL - $${tradeSize.toLocaleString()} BUY

${market.question}

Trade: $${tradeSize.toLocaleString()} at ${pricePercent}%
Rank: #${rank} of ${totalTrades} trades (${percentileStr}th percentile)
Median trade: $${medianSize.toFixed(0)} (this is ${multiplier}x larger)

Someone placed an unusually large bet at a low price. High insider probability.

${marketUrl ? `Trade: ${marketUrl}` : ''}`;
    }

    private getSeverityEmoji(severity: AnomalySeverity): string {
        switch (severity) {
            case 'CRITICAL':
                return '🚨🚨🚨';
            case 'HIGH':
                return '🚨';
            case 'MEDIUM':
                return '⚠️';
            case 'LOW':
                return '📊';
            default:
                return '📊';
        }
    }

    private resetAlertCountIfNeeded(): void {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        if (now - this.alertCountResetTime > oneHour) {
            this.alertCount = 0;
            this.alertCountResetTime = now;
        }
    }

    /**
     * Send raw message via Telegram (bypasses notifier's info prefix)
     */
    private async sendRaw(message: string): Promise<void> {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;

        if (!botToken || !chatId) {
            console.log('Telegram not configured, logging alert:');
            console.log(message);
            return;
        }

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                disable_web_page_preview: true,
            }),
        });

        const result = await response.json();
        if (!result.ok) {
            throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
        }
    }

    /**
     * Send a status message (uses notifier)
     */
    async sendStatus(message: string): Promise<void> {
        await this.notifier.notifyStatus(message);
    }

    /**
     * Get alert stats for debugging
     */
    getStats(): { alertsThisHour: number; cooldownCount: number } {
        this.resetAlertCountIfNeeded();
        return {
            alertsThisHour: this.alertCount,
            cooldownCount: this.recentAlerts.size,
        };
    }

    /**
     * Clear cooldowns (useful for testing)
     */
    clearCooldowns(): void {
        this.recentAlerts.clear();
        this.alertCount = 0;
    }
}

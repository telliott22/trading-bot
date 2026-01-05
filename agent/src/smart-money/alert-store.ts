/**
 * Alert Store
 * Persists alerts to JSON file and pushes to GitHub for dashboard access
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Anomaly } from './types';

export interface StoredAlert {
    id: string;
    type: string;
    marketId: string;
    marketQuestion: string;
    severity: string;
    timestamp: number;
    currentPrice: number;
    impliedDirection: string;
    details: Record<string, any>;
    // Outcome tracking (filled in later)
    priceAfter1h?: number;
    priceAfter24h?: number;
    resolved?: boolean;
    profitable?: boolean;
}

export interface AlertStoreData {
    lastUpdated: string;
    totalAlerts: number;
    alerts: StoredAlert[];
    stats: {
        byType: Record<string, number>;
        bySeverity: Record<string, number>;
        last24h: number;
        last7d: number;
    };
}

export class AlertStore {
    private filePath: string;
    private data: AlertStoreData;
    private maxAlerts: number = 1000; // Keep last 1000 alerts

    constructor(filePath: string = '../ui/public/smart-money-alerts.json') {
        this.filePath = path.resolve(__dirname, '../../..', filePath);
        this.data = this.load();
    }

    /**
     * Load existing alerts from file
     */
    private load(): AlertStoreData {
        try {
            if (fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, 'utf-8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('Error loading alert store:', error);
        }

        return {
            lastUpdated: new Date().toISOString(),
            totalAlerts: 0,
            alerts: [],
            stats: {
                byType: {},
                bySeverity: {},
                last24h: 0,
                last7d: 0,
            },
        };
    }

    /**
     * Save alerts to file
     */
    private save(): void {
        try {
            // Ensure directory exists
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Update stats before saving
            this.updateStats();

            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('Error saving alert store:', error);
        }
    }

    /**
     * Add a new alert
     */
    addAlert(anomaly: Anomaly): StoredAlert {
        const alert: StoredAlert = {
            id: `${anomaly.marketId}-${anomaly.type}-${anomaly.timestamp}`,
            type: anomaly.type,
            marketId: anomaly.marketId,
            marketQuestion: anomaly.marketQuestion,
            severity: anomaly.severity,
            timestamp: anomaly.timestamp,
            currentPrice: anomaly.currentPrice,
            impliedDirection: anomaly.impliedDirection,
            details: anomaly.details,
        };

        // Add to beginning (most recent first)
        this.data.alerts.unshift(alert);
        this.data.totalAlerts++;

        // Trim old alerts
        if (this.data.alerts.length > this.maxAlerts) {
            this.data.alerts = this.data.alerts.slice(0, this.maxAlerts);
        }

        this.save();
        return alert;
    }

    /**
     * Update statistics
     */
    private updateStats(): void {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const sevenDays = 7 * oneDay;

        const byType: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};
        let last24h = 0;
        let last7d = 0;

        for (const alert of this.data.alerts) {
            // Count by type
            byType[alert.type] = (byType[alert.type] || 0) + 1;

            // Count by severity
            bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;

            // Count recent
            const age = now - alert.timestamp;
            if (age < oneDay) last24h++;
            if (age < sevenDays) last7d++;
        }

        this.data.stats = { byType, bySeverity, last24h, last7d };
        this.data.lastUpdated = new Date().toISOString();
    }

    /**
     * Get recent alerts
     */
    getRecentAlerts(count: number = 50): StoredAlert[] {
        return this.data.alerts.slice(0, count);
    }

    /**
     * Get stats for health endpoint
     */
    getStats(): AlertStoreData['stats'] & { totalAlerts: number; lastUpdated: string } {
        this.updateStats();
        return {
            ...this.data.stats,
            totalAlerts: this.data.totalAlerts,
            lastUpdated: this.data.lastUpdated,
        };
    }

    /**
     * Push to GitHub for dashboard access
     */
    async pushToGitHub(): Promise<void> {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            console.log('[AlertStore] No GITHUB_TOKEN, skipping push');
            return;
        }

        try {
            const repoDir = path.resolve(__dirname, '../../..');

            // Configure git
            execSync('git config user.email "bot@polymarket-agent.com"', { cwd: repoDir });
            execSync('git config user.name "Polymarket Bot"', { cwd: repoDir });

            // Check if file changed
            const status = execSync('git status --porcelain', { cwd: repoDir }).toString();
            if (!status.includes('smart-money-alerts.json')) {
                console.log('[AlertStore] No changes to push');
                return;
            }

            // Add and commit
            execSync('git add ui/public/smart-money-alerts.json', { cwd: repoDir });
            execSync('git commit -m "Update smart-money-alerts.json [automated]"', { cwd: repoDir });

            // Push with token
            const remoteUrl = `https://x-access-token:${token}@github.com/telliott22/trading-bot.git`;
            execSync(`git push ${remoteUrl} HEAD:main`, { cwd: repoDir });

            console.log('[AlertStore] Pushed alerts to GitHub');
        } catch (error: any) {
            // Don't fail if push fails - just log
            if (!error.message?.includes('nothing to commit')) {
                console.error('[AlertStore] Error pushing to GitHub:', error.message);
            }
        }
    }
}

/**
 * Health Server
 * Simple HTTP server for health checks and status
 */

import * as http from 'http';
import { SmartMoneyDetector } from './detector';
import { AlertStore } from './alert-store';

export class HealthServer {
    private server: http.Server | null = null;
    private detector: SmartMoneyDetector;
    private alertStore: AlertStore;
    private startTime: number;
    private port: number;

    constructor(detector: SmartMoneyDetector, alertStore: AlertStore, port: number = 3001) {
        this.detector = detector;
        this.alertStore = alertStore;
        this.startTime = Date.now();
        this.port = port;
    }

    start(): void {
        this.server = http.createServer((req, res) => {
            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');

            if (req.url === '/health' || req.url === '/') {
                this.handleHealth(res);
            } else if (req.url === '/stats') {
                this.handleStats(res);
            } else if (req.url === '/alerts') {
                this.handleAlerts(res);
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        });

        this.server.listen(this.port, () => {
            console.log(`Health server listening on port ${this.port}`);
            console.log(`  - GET /health - Basic health check`);
            console.log(`  - GET /stats  - Detailed statistics`);
            console.log(`  - GET /alerts - Recent alerts`);
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    private handleHealth(res: http.ServerResponse): void {
        const uptime = Date.now() - this.startTime;
        const stats = this.detector.getStats();

        res.statusCode = 200;
        res.end(JSON.stringify({
            status: 'ok',
            service: 'smart-money-detector',
            uptime: {
                ms: uptime,
                human: this.formatUptime(uptime),
            },
            markets: stats.markets,
            trades: stats.trades,
            alertsThisHour: stats.alertsThisHour,
        }));
    }

    private handleStats(res: http.ServerResponse): void {
        const uptime = Date.now() - this.startTime;
        const detectorStats = this.detector.getStats();
        const alertStats = this.alertStore.getStats();

        res.statusCode = 200;
        res.end(JSON.stringify({
            status: 'ok',
            uptime: {
                ms: uptime,
                human: this.formatUptime(uptime),
            },
            detector: {
                markets: detectorStats.markets,
                trades: detectorStats.trades,
                baselinesReady: detectorStats.baselinesReady,
                alertsThisHour: detectorStats.alertsThisHour,
            },
            alerts: {
                total: alertStats.totalAlerts,
                last24h: alertStats.last24h,
                last7d: alertStats.last7d,
                byType: alertStats.byType,
                bySeverity: alertStats.bySeverity,
                lastUpdated: alertStats.lastUpdated,
            },
        }));
    }

    private handleAlerts(res: http.ServerResponse): void {
        const alerts = this.alertStore.getRecentAlerts(50);

        res.statusCode = 200;
        res.end(JSON.stringify({
            count: alerts.length,
            alerts,
        }));
    }

    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
}

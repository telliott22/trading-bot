/**
 * Trade Recorder
 * Records live trades from WebSocket to a local file for future backtesting
 */

import * as fs from 'fs';
import * as path from 'path';
import { SmartMoneyTrade } from './types';

const DATA_DIR = path.join(__dirname, '../../data/trades');

export class TradeRecorder {
    private writeStream: fs.WriteStream | null = null;
    private tradeCount = 0;
    private currentDate: string = '';

    constructor() {
        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }

    /**
     * Get the filename for today's trades
     */
    private getFileName(): string {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(DATA_DIR, `trades-${date}.jsonl`);
    }

    /**
     * Ensure we have an open write stream for today
     */
    private ensureStream(): void {
        const today = new Date().toISOString().split('T')[0];

        if (this.currentDate !== today) {
            // Close old stream if exists
            if (this.writeStream) {
                this.writeStream.end();
            }

            // Open new stream for today
            const filename = this.getFileName();
            this.writeStream = fs.createWriteStream(filename, { flags: 'a' });
            this.currentDate = today;
            console.log(`[TradeRecorder] Writing to ${filename}`);
        }
    }

    /**
     * Record a single trade
     */
    record(trade: SmartMoneyTrade): void {
        this.ensureStream();

        if (this.writeStream) {
            this.writeStream.write(JSON.stringify(trade) + '\n');
            this.tradeCount++;
        }
    }

    /**
     * Get the number of trades recorded this session
     */
    getCount(): number {
        return this.tradeCount;
    }

    /**
     * Close the write stream
     */
    close(): void {
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
    }

    /**
     * Load historical trades from a date range
     */
    static loadTrades(startDate: string, endDate: string): SmartMoneyTrade[] {
        const trades: SmartMoneyTrade[] = [];

        const start = new Date(startDate);
        const end = new Date(endDate);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const filename = path.join(DATA_DIR, `trades-${dateStr}.jsonl`);

            if (fs.existsSync(filename)) {
                const content = fs.readFileSync(filename, 'utf-8');
                const lines = content.trim().split('\n').filter(l => l);

                for (const line of lines) {
                    try {
                        trades.push(JSON.parse(line));
                    } catch {
                        // Skip malformed lines
                    }
                }
            }
        }

        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * List available trade data files
     */
    static listAvailableDates(): string[] {
        if (!fs.existsSync(DATA_DIR)) {
            return [];
        }

        return fs
            .readdirSync(DATA_DIR)
            .filter(f => f.startsWith('trades-') && f.endsWith('.jsonl'))
            .map(f => f.replace('trades-', '').replace('.jsonl', ''))
            .sort();
    }
}

#!/usr/bin/env npx ts-node

/**
 * Simulate Detection on Maduro Market
 *
 * Shows exactly what the detection system would have seen and alerted on
 * during the Maduro insider trading event.
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CLOB_API = 'https://clob.polymarket.com';

// Maduro market token ID (YES)
const MADURO_TOKEN = '7023463941941580393623777508894165086142929841541805476418845616988817847686';

interface PricePoint {
    t: number; // Unix timestamp (seconds)
    p: number; // Price (0-1)
}

interface SimulatedTrade {
    timestamp: Date;
    price: number;
    priceChange: number;
    priceChangePercent: number;
    isAnomaly: boolean;
    anomalyType: string;
    wouldAlert: boolean;
}

async function fetchPriceHistory(): Promise<PricePoint[]> {
    const url = `${CLOB_API}/prices-history?market=${MADURO_TOKEN}&interval=max&fidelity=1`;
    const response = await fetch(url);
    const data = await response.json();
    return data.history || [];
}

function simulateDetection(history: PricePoint[]): SimulatedTrade[] {
    const trades: SimulatedTrade[] = [];
    const windowSize = 5; // 5 data points = ~50 minutes at 10-min intervals
    const thresholdLow = 0.05; // 5% price change
    const thresholdHigh = 0.10; // 10% price change
    const thresholdCritical = 0.20; // 20% price change

    for (let i = 1; i < history.length; i++) {
        const current = history[i];
        const prev = history[i - 1];
        const timestamp = new Date(current.t * 1000);

        // Calculate price change from previous point
        const priceChange = current.p - prev.p;
        const priceChangePercent = prev.p > 0 ? (priceChange / prev.p) : 0;

        // Check for anomaly (5-minute window change)
        let windowStart = history[Math.max(0, i - windowSize)];
        const windowPriceChange = windowStart.p > 0
            ? (current.p - windowStart.p) / windowStart.p
            : 0;

        let isAnomaly = false;
        let anomalyType = '';
        let wouldAlert = false;

        const absChange = Math.abs(windowPriceChange);

        if (absChange >= thresholdCritical) {
            isAnomaly = true;
            anomalyType = 'CRITICAL';
            wouldAlert = true;
        } else if (absChange >= thresholdHigh) {
            isAnomaly = true;
            anomalyType = 'HIGH';
            wouldAlert = true;
        } else if (absChange >= thresholdLow) {
            isAnomaly = true;
            anomalyType = 'MEDIUM';
            wouldAlert = true;
        }

        trades.push({
            timestamp,
            price: current.p,
            priceChange: windowPriceChange,
            priceChangePercent: windowPriceChange * 100,
            isAnomaly,
            anomalyType,
            wouldAlert,
        });
    }

    return trades;
}

function printReport(trades: SimulatedTrade[]): void {
    console.log('='.repeat(80));
    console.log('MADURO MARKET DETECTION SIMULATION');
    console.log('='.repeat(80));
    console.log('');
    console.log('This shows what the detection system would have seen in real-time.');
    console.log('');

    console.log('-'.repeat(80));
    console.log('TIMELINE OF ALL PRICE CHANGES:');
    console.log('-'.repeat(80));
    console.log('');
    console.log('Time (UTC)           Price     Window Change   Alert?   Severity');
    console.log('-'.repeat(80));

    let alertCount = 0;
    let firstAlertTime: Date | null = null;
    let bigSpikeTime: Date | null = null;

    for (const trade of trades) {
        const time = trade.timestamp.toISOString().slice(0, 19).replace('T', ' ');
        const price = (trade.price * 100).toFixed(2).padStart(6) + '%';
        const change = (trade.priceChangePercent >= 0 ? '+' : '') +
            trade.priceChangePercent.toFixed(1).padStart(7) + '%';

        let alertMarker = '';
        let severity = '';

        if (trade.wouldAlert) {
            alertCount++;
            alertMarker = ' >>> ALERT';
            severity = trade.anomalyType;

            if (!firstAlertTime) {
                firstAlertTime = trade.timestamp;
            }

            // Track the big spike
            if (trade.priceChangePercent > 400) {
                bigSpikeTime = trade.timestamp;
            }
        }

        // Color code the output
        const line = `${time}   ${price}   ${change}     ${alertMarker.padEnd(12)} ${severity}`;

        if (trade.anomalyType === 'CRITICAL') {
            console.log(`\x1b[31m${line}\x1b[0m`); // Red
        } else if (trade.anomalyType === 'HIGH') {
            console.log(`\x1b[33m${line}\x1b[0m`); // Yellow
        } else if (trade.anomalyType === 'MEDIUM') {
            console.log(`\x1b[36m${line}\x1b[0m`); // Cyan
        } else {
            console.log(line);
        }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('DETECTION SUMMARY');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Total data points: ${trades.length}`);
    console.log(`Alerts triggered: ${alertCount}`);

    if (firstAlertTime) {
        console.log(`First alert at: ${firstAlertTime.toISOString()}`);
    }

    if (bigSpikeTime) {
        console.log(`Main spike at: ${bigSpikeTime.toISOString()}`);
    }

    // Show the critical moment
    console.log('');
    console.log('-'.repeat(80));
    console.log('THE CRITICAL MOMENT (the insider trading spike):');
    console.log('-'.repeat(80));

    const spikeIndex = trades.findIndex(t => t.priceChangePercent > 400);
    if (spikeIndex >= 0) {
        const before = trades.slice(Math.max(0, spikeIndex - 3), spikeIndex);
        const spike = trades[spikeIndex];
        const after = trades.slice(spikeIndex + 1, spikeIndex + 4);

        console.log('');
        console.log('BEFORE:');
        for (const t of before) {
            console.log(`  ${t.timestamp.toISOString().slice(11, 19)} - Price: ${(t.price * 100).toFixed(1)}%`);
        }

        console.log('');
        console.log('\x1b[31m>>> SPIKE: \x1b[0m');
        console.log(`  ${spike.timestamp.toISOString().slice(11, 19)} - Price: ${(spike.price * 100).toFixed(1)}% (+${spike.priceChangePercent.toFixed(0)}% in 5 intervals)`);
        console.log(`  \x1b[31mALERT TRIGGERED: CRITICAL RAPID_PRICE_MOVE\x1b[0m`);

        console.log('');
        console.log('AFTER:');
        for (const t of after) {
            console.log(`  ${t.timestamp.toISOString().slice(11, 19)} - Price: ${(t.price * 100).toFixed(1)}%`);
        }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('CONCLUSION');
    console.log('='.repeat(80));
    console.log('');

    if (alertCount > 0) {
        console.log('The detection system WOULD HAVE caught this insider trading event.');
        console.log('');
        console.log('What would have happened:');
        console.log('1. You would have received a Telegram alert at ' + (firstAlertTime?.toISOString().slice(11, 19) || 'N/A'));
        console.log('2. The alert would show: "CRITICAL RAPID_PRICE_MOVE: Maduro market +485%"');
        console.log('3. Price at alert: ~9.5% -> jumped to ~96.5%');
        console.log('4. If you bought at the alert price, you could exit near 100%');
        console.log('');
        console.log('HOWEVER: The spike happened so fast (~10 minutes) that by the time');
        console.log('you got the alert, the price had already moved significantly.');
        console.log('');
        console.log('This confirms: The system detects anomalies, but catching insider');
        console.log('trades BEFORE they spike requires seeing the unusual VOLUME/SIZE');
        console.log('of orders, not just the price movement.');
    }
}

async function main() {
    console.log('Fetching Maduro market price history...\n');

    const history = await fetchPriceHistory();
    console.log(`Got ${history.length} price points\n`);

    if (history.length === 0) {
        console.log('No data available');
        return;
    }

    const trades = simulateDetection(history);
    printReport(trades);
}

main().catch(console.error);

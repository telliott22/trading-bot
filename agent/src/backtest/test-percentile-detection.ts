#!/usr/bin/env npx ts-node

/**
 * Test Percentile-Based Insider Detection
 *
 * Validates that our percentile-based detection would catch
 * the Maduro market insider trades
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { MarketStatsManager, MarketStats } from '../smart-money/market-stats';

interface Trade {
    trade_time: string;
    wallet: string;
    side: 'BUY' | 'SELL';
    shares: number;
    usdc_amount: number;
    price: number;
}

async function fetchTrades(): Promise<Trade[]> {
    const response = await fetch(
        'https://api.dune.com/api/v1/query/6465327/results?limit=50000',
        {
            headers: {
                'x-dune-api-key': process.env.DUNE_API_KEY || '',
            },
        }
    );

    const data = await response.json();
    return data.result?.rows || [];
}

async function testDetection() {
    console.log('='.repeat(70));
    console.log('PERCENTILE-BASED INSIDER DETECTION TEST');
    console.log('='.repeat(70));
    console.log('');

    const trades = await fetchTrades();
    console.log(`Fetched ${trades.length} trades from Dune\n`);

    // The spike happened at ~09:30 on Jan 3, 2026
    const spikeTime = new Date('2026-01-03T09:30:00Z');
    const tradesBeforeSpike = trades.filter(t => new Date(t.trade_time) < spikeTime);

    console.log(`Trades before spike: ${tradesBeforeSpike.length}`);
    console.log('');

    // Create market stats manager
    const statsManager = new MarketStatsManager({
        lowPriceThreshold: 0.25,  // Only flag buys below 25%
        mediumPercentile: 0.90,
        highPercentile: 0.95,
        criticalPercentile: 0.99,
        minSamples: 50,
    });

    const marketId = 'maduro-out-jan-31';
    const alerts: Array<{ trade: Trade; result: any }> = [];

    // Process trades in chronological order
    const sortedTrades = tradesBeforeSpike.sort(
        (a, b) => new Date(a.trade_time).getTime() - new Date(b.trade_time).getTime()
    );

    console.log('Processing trades...\n');

    for (const trade of sortedTrades) {
        // Add trade to stats
        statsManager.addTrade(
            marketId,
            trade.usdc_amount,
            trade.price,
            trade.side,
            new Date(trade.trade_time).getTime()
        );

        // Check if this trade would trigger an alert
        const result = statsManager.checkTrade(
            marketId,
            trade.usdc_amount,
            trade.price,
            trade.side
        );

        if (result) {
            alerts.push({ trade, result });
        }
    }

    // Report results
    console.log('='.repeat(70));
    console.log('ALERTS THAT WOULD HAVE BEEN TRIGGERED');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Total alerts: ${alerts.length}\n`);

    // Group by severity
    const criticalAlerts = alerts.filter(a => a.result.severity === 'CRITICAL');
    const highAlerts = alerts.filter(a => a.result.severity === 'HIGH');
    const mediumAlerts = alerts.filter(a => a.result.severity === 'MEDIUM');

    console.log(`CRITICAL (99th+ percentile): ${criticalAlerts.length}`);
    console.log(`HIGH (95th-99th percentile): ${highAlerts.length}`);
    console.log(`MEDIUM (90th-95th percentile): ${mediumAlerts.length}`);
    console.log('');

    // Show critical alerts
    if (criticalAlerts.length > 0) {
        console.log('='.repeat(70));
        console.log('CRITICAL ALERTS (top 1% trades):');
        console.log('='.repeat(70));
        console.log('');
        console.log('Time                   Wallet             Amount       Price    Rank   Percentile');
        console.log('-'.repeat(90));

        for (const { trade, result } of criticalAlerts) {
            const time = trade.trade_time.slice(0, 19);
            const wallet = trade.wallet.slice(0, 10) + '...' + trade.wallet.slice(-4);
            const amount = ('$' + trade.usdc_amount.toFixed(0)).padStart(10);
            const price = ((trade.price * 100).toFixed(1) + '%').padStart(8);
            const rank = `#${result.rank}`.padStart(5);
            const pctl = ((result.percentile * 100).toFixed(1) + '%').padStart(9);

            console.log(`${time}   ${wallet}   ${amount}   ${price}   ${rank}   ${pctl}`);
        }
    }

    // Show high alerts
    if (highAlerts.length > 0) {
        console.log('');
        console.log('='.repeat(70));
        console.log('HIGH ALERTS (top 5% trades):');
        console.log('='.repeat(70));
        console.log('');
        console.log('Time                   Wallet             Amount       Price    Rank   Percentile');
        console.log('-'.repeat(90));

        for (const { trade, result } of highAlerts.slice(0, 15)) {
            const time = trade.trade_time.slice(0, 19);
            const wallet = trade.wallet.slice(0, 10) + '...' + trade.wallet.slice(-4);
            const amount = ('$' + trade.usdc_amount.toFixed(0)).padStart(10);
            const price = ((trade.price * 100).toFixed(1) + '%').padStart(8);
            const rank = `#${result.rank}`.padStart(5);
            const pctl = ((result.percentile * 100).toFixed(1) + '%').padStart(9);

            console.log(`${time}   ${wallet}   ${amount}   ${price}   ${rank}   ${pctl}`);
        }
        if (highAlerts.length > 15) {
            console.log(`... and ${highAlerts.length - 15} more`);
        }
    }

    // Final stats
    const stats = statsManager.getMarket(marketId).getStats();
    console.log('');
    console.log('='.repeat(70));
    console.log('MARKET STATISTICS AT END');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Total trades processed: ${stats.totalTrades}`);
    console.log(`Low-price buys tracked: ${stats.lowPriceBuys}`);
    console.log(`Median trade size: $${stats.medianSize.toFixed(2)}`);
    console.log(`90th percentile: $${stats.p90.toFixed(2)}`);
    console.log(`95th percentile: $${stats.p95.toFixed(2)}`);
    console.log(`99th percentile: $${stats.p99.toFixed(2)}`);
    console.log('');

    // Check known insider wallets
    console.log('='.repeat(70));
    console.log('KNOWN INSIDER WALLETS DETECTION CHECK');
    console.log('='.repeat(70));
    console.log('');

    const insiderWallets = [
        '0xb6bed94e7ea1e6a1c3c6af0e863b0e5dcb9e0ad3',  // $5,400 buyer
        '0x3a8651c4b01a0e051f7cfa5e2fa04fbd8dd5a0d7',  // $2,958 buyer
    ];

    for (const walletPrefix of insiderWallets) {
        const walletAlerts = alerts.filter(a =>
            a.trade.wallet.toLowerCase().startsWith(walletPrefix.toLowerCase())
        );
        if (walletAlerts.length > 0) {
            console.log(`Wallet ${walletPrefix.slice(0, 10)}...`);
            console.log(`  Total alerts triggered: ${walletAlerts.length}`);
            const severities = walletAlerts.map(a => a.result.severity);
            console.log(`  Severities: ${severities.join(', ')}`);
            const totalAmt = walletAlerts.reduce((sum, a) => sum + a.trade.usdc_amount, 0);
            console.log(`  Total USD in alerts: $${totalAmt.toFixed(0)}`);
            console.log('');
        }
    }

    console.log('='.repeat(70));
    console.log('CONCLUSION');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Would have detected ${alerts.length} unusual trades before the spike.`);
    console.log(`${criticalAlerts.length} would have been CRITICAL (99th percentile).`);
    console.log(`${highAlerts.length} would have been HIGH (95th percentile).`);
    console.log('');
}

testDetection().catch(console.error);

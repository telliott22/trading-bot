#!/usr/bin/env npx ts-node

/**
 * Analyze "Maduro Out by Jan 31" Market
 *
 * This is the $11M market where the $32K insider bet likely happened.
 * Looking for large unusual trades before the Jan 3 spike.
 */

import * as dotenv from 'dotenv';
dotenv.config();

interface Trade {
    trade_time: string;
    wallet: string;
    side: 'BUY' | 'SELL';
    shares: number;
    usdc_amount: number;
    price: number;
    tx_hash: string;
}

interface WalletSummary {
    wallet: string;
    totalBuyUsd: number;
    totalBuyShares: number;
    avgBuyPrice: number;
    buyCount: number;
    firstBuyTime: string;
    lastBuyTime: string;
    potentialProfit: number;
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

function analyzeInsiderTrading(trades: Trade[]): void {
    console.log('='.repeat(80));
    console.log('MADURO OUT BY JAN 31 - INSIDER TRADING ANALYSIS');
    console.log('='.repeat(80));
    console.log('');

    // The spike happened at ~09:30 on Jan 3, 2026
    const spikeTime = new Date('2026-01-03T09:30:00Z');

    // The alleged insider trades were Dec 27-28
    const insiderWindowStart = new Date('2025-12-27T00:00:00Z');
    const insiderWindowEnd = new Date('2025-12-29T00:00:00Z');

    const tradesBeforeSpike = trades.filter(t => new Date(t.trade_time) < spikeTime);
    const tradesAfterSpike = trades.filter(t => new Date(t.trade_time) >= spikeTime);
    const tradesInInsiderWindow = trades.filter(t => {
        const time = new Date(t.trade_time);
        return time >= insiderWindowStart && time < insiderWindowEnd;
    });

    console.log(`Total trades: ${trades.length}`);
    console.log(`Trades BEFORE spike (Jan 3 09:30): ${tradesBeforeSpike.length}`);
    console.log(`Trades AFTER spike: ${tradesAfterSpike.length}`);
    console.log(`Trades in insider window (Dec 27-28): ${tradesInInsiderWindow.length}`);
    console.log('');

    // Look at BUY trades before spike
    const buysBeforeSpike = tradesBeforeSpike.filter(t => t.side === 'BUY');
    const amounts = buysBeforeSpike.map(t => t.usdc_amount).sort((a, b) => a - b);

    console.log('='.repeat(80));
    console.log('TRADE SIZE DISTRIBUTION (all BUYs before spike):');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Total BUY trades: ${amounts.length}`);
    if (amounts.length > 0) {
        const sum = amounts.reduce((a, b) => a + b, 0);
        const median = amounts[Math.floor(amounts.length / 2)];
        const p90 = amounts[Math.floor(amounts.length * 0.90)];
        const p95 = amounts[Math.floor(amounts.length * 0.95)];
        const p99 = amounts[Math.floor(amounts.length * 0.99)];
        console.log(`  Median: $${median.toFixed(2)}`);
        console.log(`  90th percentile: $${p90.toFixed(2)}`);
        console.log(`  95th percentile: $${p95.toFixed(2)}`);
        console.log(`  99th percentile: $${p99.toFixed(2)}`);
        console.log(`  Max: $${amounts[amounts.length - 1].toFixed(2)}`);
        console.log(`  Total volume: $${sum.toFixed(2)}`);
    }
    console.log('');

    // Find the LARGEST BUY trades
    console.log('='.repeat(80));
    console.log('LARGEST BUY TRADES (before spike):');
    console.log('='.repeat(80));
    console.log('');
    console.log('Time (UTC)           Wallet                                      USDC      Shares    Price');
    console.log('-'.repeat(100));

    const largeBuys = buysBeforeSpike
        .sort((a, b) => b.usdc_amount - a.usdc_amount)
        .slice(0, 30);

    for (const trade of largeBuys) {
        const time = trade.trade_time.slice(0, 19);
        const wallet = trade.wallet.slice(0, 10) + '...' + trade.wallet.slice(-6);
        const usdc = ('$' + trade.usdc_amount.toFixed(2)).padStart(12);
        const shares = trade.shares.toFixed(0).padStart(8);
        const price = (trade.price * 100).toFixed(1).padStart(6) + '%';

        console.log(`${time}   ${wallet}   ${usdc}   ${shares}   ${price}`);
    }

    // Look specifically at Dec 27-28 trades
    console.log('');
    console.log('='.repeat(80));
    console.log('DEC 27-28 TRADES (alleged insider window):');
    console.log('='.repeat(80));
    console.log('');

    const dec27Buys = tradesInInsiderWindow.filter(t => t.side === 'BUY');
    console.log(`BUY trades in window: ${dec27Buys.length}`);

    if (dec27Buys.length > 0) {
        const dec27Sum = dec27Buys.reduce((a, b) => a + b.usdc_amount, 0);
        console.log(`Total BUY volume: $${dec27Sum.toFixed(2)}`);
        console.log('');
        console.log('All BUY trades in Dec 27-28:');
        console.log('-'.repeat(100));

        for (const trade of dec27Buys.sort((a, b) => b.usdc_amount - a.usdc_amount)) {
            const time = trade.trade_time.slice(0, 19);
            const wallet = trade.wallet.slice(0, 10) + '...' + trade.wallet.slice(-6);
            const usdc = ('$' + trade.usdc_amount.toFixed(2)).padStart(12);
            const shares = trade.shares.toFixed(0).padStart(8);
            const price = (trade.price * 100).toFixed(1).padStart(6) + '%';

            console.log(`${time}   ${wallet}   ${usdc}   ${shares}   ${price}`);
        }
    }

    // Aggregate by wallet - find who bought the most before spike at low prices
    console.log('');
    console.log('='.repeat(80));
    console.log('TOP WALLETS BY BUY VOLUME (before spike, price < 25%):');
    console.log('='.repeat(80));
    console.log('');

    const lowPriceBuys = buysBeforeSpike.filter(t => t.price < 0.25);
    const walletBuys: Map<string, WalletSummary> = new Map();

    for (const trade of lowPriceBuys) {
        const existing = walletBuys.get(trade.wallet);
        if (existing) {
            existing.totalBuyUsd += trade.usdc_amount;
            existing.totalBuyShares += trade.shares;
            existing.buyCount++;
            if (trade.trade_time < existing.firstBuyTime) existing.firstBuyTime = trade.trade_time;
            if (trade.trade_time > existing.lastBuyTime) existing.lastBuyTime = trade.trade_time;
        } else {
            walletBuys.set(trade.wallet, {
                wallet: trade.wallet,
                totalBuyUsd: trade.usdc_amount,
                totalBuyShares: trade.shares,
                avgBuyPrice: 0,
                buyCount: 1,
                firstBuyTime: trade.trade_time,
                lastBuyTime: trade.trade_time,
                potentialProfit: 0,
            });
        }
    }

    // Calculate avg price and potential profit
    for (const summary of walletBuys.values()) {
        summary.avgBuyPrice = summary.totalBuyUsd / summary.totalBuyShares;
        summary.potentialProfit = summary.totalBuyShares * (1 - summary.avgBuyPrice);
    }

    const topWallets = Array.from(walletBuys.values())
        .sort((a, b) => b.totalBuyUsd - a.totalBuyUsd)
        .slice(0, 20);

    console.log('Wallet                                      Total Buy   Shares    Avg Price   Potential Profit');
    console.log('-'.repeat(100));

    for (const w of topWallets) {
        const wallet = w.wallet.slice(0, 10) + '...' + w.wallet.slice(-6);
        const totalBuy = ('$' + w.totalBuyUsd.toFixed(2)).padStart(12);
        const shares = w.totalBuyShares.toFixed(0).padStart(8);
        const avgPrice = (w.avgBuyPrice * 100).toFixed(1).padStart(8) + '%';
        const profit = ('$' + w.potentialProfit.toFixed(2)).padStart(15);

        console.log(`${wallet}   ${totalBuy}   ${shares}   ${avgPrice}   ${profit}`);
    }

    // Find the $32K bet
    console.log('');
    console.log('='.repeat(80));
    console.log('LOOKING FOR THE $32K INSIDER BET:');
    console.log('='.repeat(80));
    console.log('');

    // Check if any wallet has ~$32K in buys
    const bigBuyers = topWallets.filter(w => w.totalBuyUsd > 10000);
    if (bigBuyers.length > 0) {
        console.log('Wallets with >$10K in buys:');
        for (const w of bigBuyers) {
            console.log(`  ${w.wallet}`);
            console.log(`    - Total bought: $${w.totalBuyUsd.toFixed(2)} for ${w.totalBuyShares.toFixed(0)} shares`);
            console.log(`    - Avg price: ${(w.avgBuyPrice * 100).toFixed(1)}%`);
            console.log(`    - First buy: ${w.firstBuyTime}`);
            console.log(`    - POTENTIAL PROFIT: $${w.potentialProfit.toFixed(2)}`);
            console.log('');
        }
    } else {
        console.log('No wallets with >$10K found in low-price buys.');
        console.log('');
        console.log('Checking ALL buy amounts (not just low price):');

        // Try looking at all buys
        const allWalletBuys: Map<string, number> = new Map();
        for (const trade of buysBeforeSpike) {
            const existing = allWalletBuys.get(trade.wallet) || 0;
            allWalletBuys.set(trade.wallet, existing + trade.usdc_amount);
        }

        const allTopWallets = Array.from(allWalletBuys.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        for (const [wallet, amount] of allTopWallets) {
            console.log(`  ${wallet.slice(0, 10)}...${wallet.slice(-6)}: $${amount.toFixed(2)}`);
        }
    }

    // Percentile analysis
    console.log('');
    console.log('='.repeat(80));
    console.log('PERCENTILE ANALYSIS:');
    console.log('='.repeat(80));
    console.log('');

    if (amounts.length > 0) {
        const thresholds = [100, 500, 1000, 5000, 10000, 20000, 32000];
        for (const threshold of thresholds) {
            const rank = amounts.filter(a => a >= threshold).length;
            const pctl = ((1 - rank / amounts.length) * 100).toFixed(2);
            console.log(`  $${threshold.toLocaleString().padStart(7)} trade would be: Top ${rank}/${amounts.length} (${pctl}th percentile)`);
        }
    }
}

async function main() {
    console.log('Fetching "Maduro out by Jan 31" trades from Dune (query 6465327)...\n');

    const trades = await fetchTrades();
    console.log(`Fetched ${trades.length} trades\n`);

    if (trades.length === 0) {
        console.log('No trades found');
        return;
    }

    analyzeInsiderTrading(trades);
}

main().catch(console.error);

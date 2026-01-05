#!/usr/bin/env npx ts-node

/**
 * Analyze Maduro Trades - Find Insider Trading
 *
 * Looks for large unusual BUY trades at low prices before the spike
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';

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
        'https://api.dune.com/api/v1/query/6465163/results?limit=10000',
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
    console.log('MADURO MARKET - INSIDER TRADING ANALYSIS');
    console.log('='.repeat(80));
    console.log('');

    // The spike happened at 09:30 on Jan 3, 2026
    // Price went from ~9.5% to ~96.5%
    const spikeTime = new Date('2026-01-03T09:30:00Z');

    // Filter to trades BEFORE the spike
    const tradesBeforeSpike = trades.filter(t => new Date(t.trade_time) < spikeTime);
    const tradesAfterSpike = trades.filter(t => new Date(t.trade_time) >= spikeTime);

    console.log(`Total trades: ${trades.length}`);
    console.log(`Trades BEFORE spike (09:30): ${tradesBeforeSpike.length}`);
    console.log(`Trades AFTER spike: ${tradesAfterSpike.length}`);
    console.log('');

    // Focus on BUY trades before spike - these are the potential insiders
    const buysBeforeSpike = tradesBeforeSpike.filter(t => t.side === 'BUY');

    console.log('-'.repeat(80));
    console.log('LARGE BUY TRADES BEFORE THE SPIKE (potential insider trading):');
    console.log('-'.repeat(80));
    console.log('');

    // Sort by USD amount
    const largeBuys = buysBeforeSpike
        .filter(t => t.usdc_amount >= 10) // At least $10
        .sort((a, b) => b.usdc_amount - a.usdc_amount);

    console.log('Time (UTC)           Wallet                                      USDC      Shares    Price');
    console.log('-'.repeat(100));

    for (const trade of largeBuys.slice(0, 50)) {
        const time = trade.trade_time.slice(0, 19);
        const wallet = trade.wallet.slice(0, 10) + '...' + trade.wallet.slice(-6);
        const usdc = trade.usdc_amount.toFixed(2).padStart(10);
        const shares = trade.shares.toFixed(0).padStart(8);
        const price = (trade.price * 100).toFixed(1).padStart(6) + '%';

        console.log(`${time}   ${wallet}   $${usdc}   ${shares}   ${price}`);
    }

    // Aggregate by wallet
    console.log('');
    console.log('='.repeat(80));
    console.log('TOP WALLETS BY TOTAL BUY VOLUME (before spike):');
    console.log('='.repeat(80));
    console.log('');

    const walletBuys: Map<string, WalletSummary> = new Map();

    for (const trade of buysBeforeSpike) {
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
        // If they sold at $1 (100%), profit = shares * (1 - avgBuyPrice)
        summary.potentialProfit = summary.totalBuyShares * (1 - summary.avgBuyPrice);
    }

    // Sort by total buy USD
    const topWallets = Array.from(walletBuys.values())
        .filter(w => w.totalBuyUsd >= 50) // At least $50 bought
        .sort((a, b) => b.totalBuyUsd - a.totalBuyUsd);

    console.log('Wallet                                      Total Buy   Shares    Avg Price   Potential Profit');
    console.log('-'.repeat(100));

    for (const w of topWallets.slice(0, 20)) {
        const wallet = w.wallet.slice(0, 10) + '...' + w.wallet.slice(-6);
        const totalBuy = ('$' + w.totalBuyUsd.toFixed(2)).padStart(10);
        const shares = w.totalBuyShares.toFixed(0).padStart(8);
        const avgPrice = (w.avgBuyPrice * 100).toFixed(1).padStart(8) + '%';
        const profit = ('$' + w.potentialProfit.toFixed(2)).padStart(15);

        console.log(`${wallet}   ${totalBuy}   ${shares}   ${avgPrice}   ${profit}`);
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('SUSPICIOUS PATTERN DETECTION:');
    console.log('='.repeat(80));
    console.log('');

    // Flag wallets that:
    // 1. Bought a lot at low prices
    // 2. Only bought (no sells)
    // 3. Made large potential profit

    const suspicious = topWallets.filter(w =>
        w.avgBuyPrice < 0.25 && // Bought at <25%
        w.potentialProfit > 100 // Would have made >$100
    );

    console.log('Wallets that bought at LOW PRICES (<25%) with LARGE potential profit:');
    console.log('');

    for (const w of suspicious) {
        const wallet = w.wallet;
        console.log(`  ${wallet}`);
        console.log(`    - Total bought: $${w.totalBuyUsd.toFixed(2)} for ${w.totalBuyShares.toFixed(0)} shares`);
        console.log(`    - Avg price: ${(w.avgBuyPrice * 100).toFixed(1)}%`);
        console.log(`    - First buy: ${w.firstBuyTime}`);
        console.log(`    - POTENTIAL PROFIT: $${w.potentialProfit.toFixed(2)} (${((w.potentialProfit / w.totalBuyUsd) * 100).toFixed(0)}% return)`);
        console.log('');
    }

    // What the detection system would have caught
    console.log('='.repeat(80));
    console.log('WHAT OUR DETECTION SYSTEM SHOULD FLAG:');
    console.log('='.repeat(80));
    console.log('');

    // Find single large trades
    const veryLargeTrades = buysBeforeSpike.filter(t => t.usdc_amount >= 100);
    console.log(`Large single trades (>$100): ${veryLargeTrades.length}`);

    for (const t of veryLargeTrades.sort((a, b) => b.usdc_amount - a.usdc_amount).slice(0, 10)) {
        console.log(`  ${t.trade_time.slice(11, 19)} - $${t.usdc_amount.toFixed(2)} at ${(t.price * 100).toFixed(1)}% by ${t.wallet.slice(0, 10)}...`);
    }

    console.log('');
    console.log('These trades SHOULD trigger LARGE_TRADE alerts in our detection system.');
}

async function main() {
    console.log('Fetching Maduro market trades from Dune...\n');

    const trades = await fetchTrades();
    console.log(`Fetched ${trades.length} trades\n`);

    if (trades.length === 0) {
        console.log('No trades found');
        return;
    }

    analyzeInsiderTrading(trades);
}

main().catch(console.error);

#!/usr/bin/env npx ts-node

/**
 * Detection System Validation
 *
 * Validates the insider trading detection system by replaying historical trades
 * through the anomaly detection engine and checking if it would have caught
 * known insider trading cases.
 *
 * Usage:
 *   npx ts-node src/backtest/validate-detection.ts --token=TOKEN_ID --start=2025-12-25 --end=2026-01-04 --news=2026-01-04T08:00:00Z
 *
 * Example (Maduro case):
 *   npx ts-node src/backtest/validate-detection.ts \
 *     --token=7023463941941580393623777508894165086142929841541805476418845616988817847686 \
 *     --start=2025-12-25 --end=2026-01-04 --news=2026-01-04T08:00:00Z
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { DuneFetcher, DuneTrade } from './dune-fetcher';
import { SmartMoneyTrade, MarketInfo, Anomaly, DEFAULT_CONFIG } from '../smart-money/types';
import { TradeStore } from '../smart-money/trade-store';
import { BaselineCalculator } from '../smart-money/baseline';
import { AnomalyEngine } from '../smart-money/anomaly-engine';

interface ValidationResult {
    market: string;
    tokenId: string;
    dateRange: { start: Date; end: Date };
    newsTime: Date;
    totalTrades: number;
    // Detection results
    anomaliesBeforeNews: Anomaly[];
    anomaliesAfterNews: Anomaly[];
    firstAnomalyTime: Date | null;
    leadTimeMinutes: number | null;
    // Wallet analysis
    uniqueWallets: number;
    largeTraders: { wallet: string; totalUsd: number; trades: number }[];
    // Price analysis
    priceAtFirstAnomaly: number | null;
    priceAtNews: number | null;
    finalPrice: number | null;
    potentialReturn: number | null;
}

async function fetchTradesFromDune(
    fetcher: DuneFetcher,
    tokenId: string,
    startDate: Date,
    endDate: Date,
    queryId: number
): Promise<DuneTrade[]> {
    try {
        return await fetcher.fetchTradesForToken(tokenId, startDate, endDate, queryId);
    } catch (error: any) {
        console.error(`Error fetching from Dune: ${error.message}`);
        return [];
    }
}

function convertDuneToSmartMoneyTrade(
    duneTrade: DuneTrade,
    marketId: string,
    conditionId: string
): SmartMoneyTrade {
    const timestamp = new Date(duneTrade.block_time).getTime();
    const price = duneTrade.price;
    const size = duneTrade.size;

    return {
        marketId,
        conditionId,
        tokenId: duneTrade.token_id,
        price,
        size,
        sizeUsd: size * price,
        side: duneTrade.side,
        timestamp,
        makerAddress: duneTrade.maker,
        takerAddress: duneTrade.taker,
    };
}

async function validateDetection(
    trades: SmartMoneyTrade[],
    market: MarketInfo,
    newsTime: Date
): Promise<ValidationResult> {
    // Sort trades by timestamp
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    if (sortedTrades.length === 0) {
        return emptyResult(market, newsTime);
    }

    // Initialize detection components
    const config = { ...DEFAULT_CONFIG };
    const tradeStore = new TradeStore(config.baselineWindowMs);
    const baselineCalc = new BaselineCalculator(config);
    const anomalyEngine = new AnomalyEngine(baselineCalc, config);

    // Track anomalies
    const anomaliesBeforeNews: Anomaly[] = [];
    const anomaliesAfterNews: Anomaly[] = [];

    // Track wallets
    const walletTotals: Map<string, { usd: number; trades: number }> = new Map();

    // Warmup with first 10% of trades
    const warmupCount = Math.max(10, Math.floor(sortedTrades.length * 0.1));
    const warmupTrades = sortedTrades.slice(0, warmupCount);
    const testTrades = sortedTrades.slice(warmupCount);

    console.log(`Warming up with ${warmupCount} trades...`);
    for (const trade of warmupTrades) {
        tradeStore.addTrade(trade);
    }
    baselineCalc.updateBaseline(market.id, warmupTrades);

    // Process test trades
    console.log(`Processing ${testTrades.length} trades...`);
    const newsTimestamp = newsTime.getTime();

    for (const trade of testTrades) {
        // Set simulated time
        tradeStore.setSimulatedTime(trade.timestamp);
        tradeStore.addTrade(trade);

        // Track wallet activity
        if (trade.makerAddress) {
            const existing = walletTotals.get(trade.makerAddress) || { usd: 0, trades: 0 };
            existing.usd += trade.sizeUsd;
            existing.trades += 1;
            walletTotals.set(trade.makerAddress, existing);
        }

        // Run anomaly detection
        const anomalies = anomalyEngine.checkAllAnomalies(trade, market, tradeStore);

        for (const anomaly of anomalies) {
            if (anomalyEngine.meetsMinSeverity(anomaly)) {
                if (trade.timestamp < newsTimestamp) {
                    anomaliesBeforeNews.push(anomaly);
                } else {
                    anomaliesAfterNews.push(anomaly);
                }
            }
        }

        // Update baseline (skip anomalies)
        if (anomalies.length === 0) {
            baselineCalc.updateBaseline(market.id, [trade]);
        }
    }

    // Calculate results
    const firstAnomaly = anomaliesBeforeNews.length > 0 ? anomaliesBeforeNews[0] : null;
    const firstAnomalyTime = firstAnomaly ? new Date(firstAnomaly.timestamp) : null;
    const leadTimeMinutes = firstAnomaly
        ? (newsTimestamp - firstAnomaly.timestamp) / (60 * 1000)
        : null;

    // Get prices
    const priceAtFirstAnomaly = firstAnomaly ? firstAnomaly.currentPrice : null;
    const tradesAtNews = sortedTrades.filter((t) => t.timestamp <= newsTimestamp);
    const priceAtNews = tradesAtNews.length > 0 ? tradesAtNews[tradesAtNews.length - 1].price : null;
    const finalPrice = sortedTrades[sortedTrades.length - 1].price;

    // Calculate potential return
    const potentialReturn =
        priceAtFirstAnomaly && finalPrice
            ? ((finalPrice - priceAtFirstAnomaly) / priceAtFirstAnomaly) * 100
            : null;

    // Find large traders (top 10 by USD volume)
    const largeTraders = Array.from(walletTotals.entries())
        .map(([wallet, data]) => ({
            wallet,
            totalUsd: data.usd,
            trades: data.trades,
        }))
        .sort((a, b) => b.totalUsd - a.totalUsd)
        .slice(0, 10);

    return {
        market: market.question,
        tokenId: market.yesTokenId,
        dateRange: {
            start: new Date(sortedTrades[0].timestamp),
            end: new Date(sortedTrades[sortedTrades.length - 1].timestamp),
        },
        newsTime,
        totalTrades: sortedTrades.length,
        anomaliesBeforeNews,
        anomaliesAfterNews,
        firstAnomalyTime,
        leadTimeMinutes,
        uniqueWallets: walletTotals.size,
        largeTraders,
        priceAtFirstAnomaly,
        priceAtNews,
        finalPrice,
        potentialReturn,
    };
}

function emptyResult(market: MarketInfo, newsTime: Date): ValidationResult {
    return {
        market: market.question,
        tokenId: market.yesTokenId,
        dateRange: { start: new Date(), end: new Date() },
        newsTime,
        totalTrades: 0,
        anomaliesBeforeNews: [],
        anomaliesAfterNews: [],
        firstAnomalyTime: null,
        leadTimeMinutes: null,
        uniqueWallets: 0,
        largeTraders: [],
        priceAtFirstAnomaly: null,
        priceAtNews: null,
        finalPrice: null,
        potentialReturn: null,
    };
}

function printReport(result: ValidationResult): void {
    console.log('\n' + '='.repeat(70));
    console.log('DETECTION SYSTEM VALIDATION');
    console.log('='.repeat(70));
    console.log(`Market: ${result.market}`);
    console.log(`Token ID: ${result.tokenId.slice(0, 20)}...`);
    console.log(`Date Range: ${result.dateRange.start.toISOString().slice(0, 10)} to ${result.dateRange.end.toISOString().slice(0, 10)}`);
    console.log(`News Event: ${result.newsTime.toISOString()}`);
    console.log(`Total Trades: ${result.totalTrades}`);
    console.log(`Unique Wallets: ${result.uniqueWallets}`);

    console.log('\n' + '-'.repeat(70));
    console.log('DETECTION RESULTS:');
    console.log('-'.repeat(70));

    if (result.firstAnomalyTime) {
        console.log(`  First anomaly: ${result.firstAnomalyTime.toISOString()}`);
        console.log(`  Lead time: ${result.leadTimeMinutes?.toFixed(0)} minutes (${(result.leadTimeMinutes! / 60).toFixed(1)} hours) before news`);
    } else {
        console.log('  No anomalies detected before news event');
    }

    console.log(`\n  Anomalies BEFORE news: ${result.anomaliesBeforeNews.length}`);

    // Count by type
    const beforeByType: Record<string, number> = {};
    for (const a of result.anomaliesBeforeNews) {
        beforeByType[a.type] = (beforeByType[a.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(beforeByType)) {
        console.log(`    - ${type}: ${count}`);
    }

    console.log(`\n  Anomalies AFTER news: ${result.anomaliesAfterNews.length}`);

    // Show first few anomalies before news
    if (result.anomaliesBeforeNews.length > 0) {
        console.log('\n  First 5 anomalies before news:');
        for (const anomaly of result.anomaliesBeforeNews.slice(0, 5)) {
            const time = new Date(anomaly.timestamp).toISOString().slice(0, 16);
            const detail =
                anomaly.type === 'LARGE_TRADE'
                    ? `$${anomaly.details.tradeSize?.toFixed(0)}`
                    : anomaly.type === 'VOLUME_SPIKE'
                    ? `${anomaly.details.volumeMultiple?.toFixed(1)}x`
                    : `${((anomaly.details.priceChange || 0) * 100).toFixed(1)}%`;
            console.log(`    ${time}  ${anomaly.type.padEnd(18)}  ${detail}  ${anomaly.severity}`);
        }
    }

    console.log('\n' + '-'.repeat(70));
    console.log('PRICE ANALYSIS:');
    console.log('-'.repeat(70));
    if (result.priceAtFirstAnomaly !== null) {
        console.log(`  Price at first anomaly: $${result.priceAtFirstAnomaly.toFixed(4)}`);
    }
    if (result.priceAtNews !== null) {
        console.log(`  Price at news time: $${result.priceAtNews.toFixed(4)}`);
    }
    if (result.finalPrice !== null) {
        console.log(`  Final price: $${result.finalPrice.toFixed(4)}`);
    }
    if (result.potentialReturn !== null) {
        console.log(`  Potential return (first anomaly to final): ${result.potentialReturn >= 0 ? '+' : ''}${result.potentialReturn.toFixed(1)}%`);
    }

    console.log('\n' + '-'.repeat(70));
    console.log('TOP TRADERS BY VOLUME:');
    console.log('-'.repeat(70));
    for (const trader of result.largeTraders.slice(0, 5)) {
        const shortWallet = trader.wallet.slice(0, 8) + '...' + trader.wallet.slice(-6);
        console.log(`  ${shortWallet}  $${trader.totalUsd.toFixed(0).padStart(8)}  ${trader.trades} trades`);
    }

    console.log('\n' + '-'.repeat(70));
    console.log('VALIDATION:');
    console.log('-'.repeat(70));
    if (result.anomaliesBeforeNews.length > 0 && result.leadTimeMinutes && result.leadTimeMinutes > 60) {
        console.log('  System WOULD HAVE caught this');
        console.log(`  Lead time: ${(result.leadTimeMinutes / 60).toFixed(1)} hours before news`);
        if (result.potentialReturn && result.potentialReturn > 0) {
            console.log(`  Potential profit: +${result.potentialReturn.toFixed(0)}%`);
        }
        console.log('\n  CONCLUSION: Detection system VALIDATED');
    } else if (result.anomaliesBeforeNews.length > 0) {
        console.log('  System detected anomalies but with limited lead time');
        console.log(`  Lead time: ${result.leadTimeMinutes?.toFixed(0)} minutes`);
        console.log('\n  CONCLUSION: Consider tuning thresholds for earlier detection');
    } else {
        console.log('  System did NOT detect anomalies before news');
        console.log('\n  CONCLUSION: Detection thresholds may need adjustment');
    }
}

async function main() {
    console.log('======================================');
    console.log('INSIDER TRADING DETECTION VALIDATION');
    console.log('======================================\n');

    // Parse args
    const args = process.argv.slice(2);
    let tokenId: string | null = null;
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let newsTime: Date | null = null;
    let queryId: number | null = null;

    for (const arg of args) {
        if (arg.startsWith('--token=')) {
            tokenId = arg.split('=')[1];
        } else if (arg.startsWith('--start=')) {
            startDate = new Date(arg.split('=')[1]);
        } else if (arg.startsWith('--end=')) {
            endDate = new Date(arg.split('=')[1]);
        } else if (arg.startsWith('--news=')) {
            newsTime = new Date(arg.split('=')[1]);
        } else if (arg.startsWith('--query=')) {
            queryId = parseInt(arg.split('=')[1], 10);
        }
    }

    // Default to Maduro case
    if (!tokenId) {
        tokenId = '7023463941941580393623777508894165086142929841541805476418845616988817847686';
        console.log('Using default: Maduro market YES token');
    }
    if (!startDate) {
        startDate = new Date('2025-12-25');
    }
    if (!endDate) {
        endDate = new Date('2026-01-05');
    }
    if (!newsTime) {
        newsTime = new Date('2026-01-04T08:00:00Z');
    }

    console.log(`Token ID: ${tokenId.slice(0, 30)}...`);
    console.log(`Date Range: ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`);
    console.log(`News Time: ${newsTime.toISOString()}`);

    if (!queryId) {
        console.log('\nERROR: No Dune query ID provided.');
        console.log('');
        console.log('To use this script, you need to:');
        console.log('1. Create a Dune account at https://dune.com');
        console.log('2. Get your API key from Settings > API');
        console.log('3. Add DUNE_API_KEY to your .env file');
        console.log('4. Create a query on Dune that returns trade data');
        console.log('5. Run with --query=YOUR_QUERY_ID');
        console.log('');
        console.log('Sample Dune SQL query:');
        console.log('');
        console.log(`SELECT
  evt_block_time as block_time,
  "tokenID" as token_id,
  maker,
  "makerAmountFilled" / 1e6 as size,
  side,
  evt_tx_hash as tx_hash
FROM polymarket_polygon.CTFExchange_evt_OrderFilled
WHERE "tokenID" = '{{token_id}}'
  AND evt_block_time >= TIMESTAMP '{{start_date}}'
  AND evt_block_time <= TIMESTAMP '{{end_date}}'
ORDER BY evt_block_time`);
        return;
    }

    // Check for API key
    if (!process.env.DUNE_API_KEY) {
        console.log('\nERROR: DUNE_API_KEY not found in environment.');
        console.log('Add it to your .env file: DUNE_API_KEY=your_key_here');
        return;
    }

    // Fetch trades from Dune
    console.log('\nFetching trades from Dune Analytics...');
    const fetcher = new DuneFetcher();
    const duneTrades = await fetchTradesFromDune(fetcher, tokenId, startDate, endDate, queryId);

    if (duneTrades.length === 0) {
        console.log('No trades found. Check your query and parameters.');
        return;
    }

    console.log(`Fetched ${duneTrades.length} trades`);

    // Create mock market info
    const market: MarketInfo = {
        id: 'maduro-custody',
        conditionId: '0xbfa45527ec959aacc36f7c312bd4f328171a7681ef1aeb3a7e34db5fb47d3f1d',
        question: 'Maduro in U.S. custody by January 31?',
        endDate: '2026-01-31',
        yesTokenId: tokenId,
        noTokenId: '106316402112581431871296425427771662624401052300497693181318308091815990317059',
    };

    // Convert trades
    const trades = duneTrades.map((t) => convertDuneToSmartMoneyTrade(t, market.id, market.conditionId));

    // Run validation
    console.log('\nRunning anomaly detection...');
    const result = await validateDetection(trades, market, newsTime);

    // Print report
    printReport(result);
}

main().catch(console.error);

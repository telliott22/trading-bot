#!/usr/bin/env npx ts-node

/**
 * Smart Money Detection Backtest
 *
 * Tests the anomaly detection system against historical trade data
 * to evaluate if we could have caught suspicious trading activity.
 *
 * Usage:
 *   cd agent
 *   npx ts-node src/backtest/index.ts [options]
 *
 * Options:
 *   --search=KEYWORD    Search for markets by keyword
 *   --slug=SLUG         Test a specific market by slug
 *   --days=N            Days of history to fetch (default: 30)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { HistoricalFetcher } from './historical-fetcher';
import { BacktestEvaluator, BacktestResult } from './evaluator';
import { MarketInfo } from '../smart-money/types';

// Known interesting markets for testing
const KNOWN_TEST_CASES = [
    // Add known markets where suspicious activity was observed
    // { slug: 'will-maduro-...', description: 'Maduro resignation rumors' },
];

async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     SMART MONEY DETECTION BACKTEST     ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    const args = process.argv.slice(2);
    let searchKeyword: string | null = null;
    let targetSlug: string | null = null;
    let days = 30;

    for (const arg of args) {
        if (arg.startsWith('--search=')) {
            searchKeyword = arg.split('=')[1];
        } else if (arg.startsWith('--slug=')) {
            targetSlug = arg.split('=')[1];
        } else if (arg.startsWith('--days=')) {
            days = parseInt(arg.split('=')[1], 10);
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    const fetcher = new HistoricalFetcher();
    const evaluator = new BacktestEvaluator();

    let marketsToTest: MarketInfo[] = [];

    if (targetSlug) {
        // Test specific market
        console.log(`Fetching market: ${targetSlug}`);
        const market = await fetcher.getMarketBySlug(targetSlug);
        if (market) {
            marketsToTest.push(market);
        } else {
            console.log(`Market not found: ${targetSlug}`);
            process.exit(1);
        }
    } else if (searchKeyword) {
        // Search for markets
        console.log(`Searching for markets matching: "${searchKeyword}"`);
        marketsToTest = await fetcher.searchMarkets(searchKeyword);
        console.log(`Found ${marketsToTest.length} markets`);

        if (marketsToTest.length === 0) {
            console.log('No markets found. Try a different search term.');
            process.exit(0);
        }

        // Show found markets
        console.log('\nMatching markets:');
        for (let i = 0; i < Math.min(marketsToTest.length, 10); i++) {
            const m = marketsToTest[i];
            console.log(`  ${i + 1}. ${m.question.slice(0, 70)}...`);
            console.log(`     Slug: ${m.slug}`);
        }
        console.log('');
    } else {
        // Interactive mode - search for something interesting
        console.log('No market specified. Try:');
        console.log('  --search=maduro     Search for markets about Maduro');
        console.log('  --slug=event-slug   Test a specific market');
        console.log('  --help              Show all options');
        console.log('');

        // Default: test a few interesting keywords
        console.log('Running default search for political/regulatory markets...\n');

        const keywords = ['resign', 'indicted', 'fed rate', 'ceasefire'];
        for (const kw of keywords) {
            console.log(`Searching: ${kw}`);
            const found = await fetcher.searchMarkets(kw);
            marketsToTest.push(...found.slice(0, 3)); // Take top 3 per keyword
            await sleep(500);
        }

        // Dedupe
        const seen = new Set<string>();
        marketsToTest = marketsToTest.filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });

        console.log(`\nFound ${marketsToTest.length} markets to test\n`);
    }

    // Run backtests
    const results: BacktestResult[] = [];

    for (const market of marketsToTest.slice(0, 5)) { // Limit to 5 for now
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing: ${market.question.slice(0, 55)}...`);
        console.log(`Slug: ${market.slug}`);
        console.log(`${'='.repeat(60)}`);

        // Fetch historical price data (trades require auth)
        const trades = await fetcher.fetchMarketHistory(
            market.id,
            market.conditionId,
            days,
            market.yesTokenId // Use YES token for price history
        );

        if (trades.length === 0) {
            console.log('  No trade data available for this market.');
            continue;
        }

        // Run backtest
        const result = await evaluator.evaluateMarket(market, trades);
        results.push(result);

        // Print results
        printResult(result);

        await sleep(1000); // Rate limiting between markets
    }

    // Print summary
    if (results.length > 0) {
        printSummary(results);
    }
}

function printResult(result: BacktestResult) {
    console.log(`\n  Date range: ${result.dateRange.start.toLocaleDateString()} - ${result.dateRange.end.toLocaleDateString()}`);
    console.log(`  Total trades: ${result.totalTrades}`);
    console.log(`  Anomalies detected: ${result.anomalies.length}`);
    console.log(`    - Large trades: ${result.anomaliesByType.LARGE_TRADE}`);
    console.log(`    - Volume spikes: ${result.anomaliesByType.VOLUME_SPIKE}`);
    console.log(`    - Price moves: ${result.anomaliesByType.RAPID_PRICE_MOVE}`);

    if (result.anomalies.length > 0) {
        console.log(`\n  Evaluation:`);
        console.log(`    Precision: ${(result.precision * 100).toFixed(1)}%`);
        console.log(`    Profitable alerts: ${result.profitableAlerts}`);
        console.log(`    Unprofitable alerts: ${result.unprofitableAlerts}`);
        console.log(`    Avg price change after alert: ${(result.avgPriceChangeAfterAlert * 100).toFixed(2)}%`);

        // Show top anomalies
        console.log(`\n  Notable anomalies:`);
        const sorted = [...result.anomalies].sort(
            (a, b) => Math.abs(b.priceChange24h || 0) - Math.abs(a.priceChange24h || 0)
        );

        for (const anomaly of sorted.slice(0, 3)) {
            const emoji =
                anomaly.severity === 'CRITICAL'
                    ? '🚨'
                    : anomaly.severity === 'HIGH'
                    ? '⚠️'
                    : '📊';
            const dir = anomaly.directionCorrect ? '✓' : '✗';
            const change = anomaly.priceChange24h
                ? `${(anomaly.priceChange24h * 100).toFixed(1)}%`
                : 'N/A';

            console.log(
                `    ${emoji} ${new Date(anomaly.timestamp).toLocaleDateString()} ${anomaly.type}: ` +
                    `Price ${(anomaly.currentPrice * 100).toFixed(1)}% → ${change} 24h later ${dir}`
            );
        }
    }
}

function printSummary(results: BacktestResult[]) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('BACKTEST SUMMARY');
    console.log(`${'='.repeat(60)}`);

    const totalAnomalies = results.reduce((sum, r) => sum + r.anomalies.length, 0);
    const totalProfitable = results.reduce((sum, r) => sum + r.profitableAlerts, 0);
    const totalUnprofitable = results.reduce((sum, r) => sum + r.unprofitableAlerts, 0);
    const avgPrecision =
        totalProfitable + totalUnprofitable > 0
            ? totalProfitable / (totalProfitable + totalUnprofitable)
            : 0;

    console.log(`\nMarkets tested: ${results.length}`);
    console.log(`Total anomalies detected: ${totalAnomalies}`);
    console.log(`Overall precision: ${(avgPrecision * 100).toFixed(1)}%`);
    console.log(`  Profitable: ${totalProfitable}`);
    console.log(`  Unprofitable: ${totalUnprofitable}`);

    if (avgPrecision > 0.5) {
        console.log(`\n✅ Detection system shows promise - alerts led to correct direction ${(avgPrecision * 100).toFixed(0)}% of the time`);
    } else if (avgPrecision > 0.3) {
        console.log(`\n⚠️ Mixed results - consider tuning thresholds`);
    } else {
        console.log(`\n❌ Poor precision - may need significant tuning or different approach`);
    }
}

function printHelp() {
    console.log(`
Smart Money Detection Backtest

Tests the anomaly detection system against historical trade data.

Usage:
  npx ts-node src/backtest/index.ts [options]

Options:
  --search=KEYWORD    Search for markets by keyword (e.g., --search=maduro)
  --slug=SLUG         Test a specific market by slug
  --days=N            Days of history to fetch (default: 30)
  --help, -h          Show this help message

Examples:
  # Search for markets about Maduro
  npx ts-node src/backtest/index.ts --search=maduro

  # Test a specific market
  npx ts-node src/backtest/index.ts --slug=will-maduro-leave-office

  # Test with more history
  npx ts-node src/backtest/index.ts --search=resign --days=60
`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);

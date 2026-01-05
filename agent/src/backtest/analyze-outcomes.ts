#!/usr/bin/env npx ts-node

/**
 * Anomaly Outcome Analysis
 *
 * Analyzes whether detected price spikes would have been profitable trades.
 * Tests both momentum (follow the spike) and mean reversion (fade the spike) strategies.
 *
 * Usage:
 *   npx ts-node src/backtest/analyze-outcomes.ts [--token=TOKEN_ID] [--days=N]
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CLOB_API = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';

interface PricePoint {
    t: number; // Unix timestamp (seconds)
    p: number; // Price (0-1)
}

interface TradeOutcome {
    timestamp: number;
    direction: 'UP' | 'DOWN';
    spikePercent: number;
    priceAtSpike: number;
    priceAfter1h: number | null;
    priceAfter24h: number | null;
    // Momentum returns (follow the direction)
    momentumReturn1h: number | null;
    momentumReturn24h: number | null;
    // Mean reversion returns (fade the direction)
    reversionReturn1h: number | null;
    reversionReturn24h: number | null;
}

interface StrategyMetrics {
    trades: number;
    wins: number;
    winRate: number;
    totalReturn: number;
    avgReturn: number;
    bestTrade: number;
    worstTrade: number;
}

interface StrategyComparison {
    momentum1h: StrategyMetrics;
    momentum24h: StrategyMetrics;
    reversion1h: StrategyMetrics;
    reversion24h: StrategyMetrics;
}

async function fetchPriceHistory(tokenId: string, days: number): Promise<PricePoint[]> {
    // Always use max interval with minute-level fidelity for best data
    // The API seems to return empty for 1w on newer markets
    const interval = 'max';
    const fidelity = 1;

    const url = `${CLOB_API}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`;

    const response = await fetch(url);
    const data = await response.json();

    return data.history || [];
}

function findAnomalies(
    history: PricePoint[],
    windowSize: number = 5,
    threshold: number = 0.05
): TradeOutcome[] {
    const outcomes: TradeOutcome[] = [];

    for (let i = windowSize; i < history.length; i++) {
        const start = history[i - windowSize];
        const end = history[i];

        if (start.p === 0) continue;

        const change = (end.p - start.p) / start.p;

        if (Math.abs(change) >= threshold) {
            // Check if this is a new anomaly (not within 5 min of previous)
            const lastAnomaly = outcomes[outcomes.length - 1];
            if (lastAnomaly && end.t - lastAnomaly.timestamp < 300) {
                continue;
            }

            const direction: 'UP' | 'DOWN' = change > 0 ? 'UP' : 'DOWN';

            // Find prices at future times
            // 1 hour = 60 data points (if 1-min fidelity)
            const idx1h = Math.min(i + 60, history.length - 1);
            const price1h = i + 60 < history.length ? history[idx1h].p : null;

            // 24 hours = 1440 data points
            const idx24h = Math.min(i + 1440, history.length - 1);
            const price24h = i + 1440 < history.length ? history[idx24h].p : null;

            // Calculate returns for each strategy
            let momentumReturn1h: number | null = null;
            let momentumReturn24h: number | null = null;
            let reversionReturn1h: number | null = null;
            let reversionReturn24h: number | null = null;

            if (price1h !== null) {
                const priceChange1h = (price1h - end.p) / end.p;
                // Momentum: profit if price continues in spike direction
                momentumReturn1h = direction === 'UP' ? priceChange1h : -priceChange1h;
                // Reversion: profit if price reverses
                reversionReturn1h = direction === 'UP' ? -priceChange1h : priceChange1h;
            }

            if (price24h !== null) {
                const priceChange24h = (price24h - end.p) / end.p;
                momentumReturn24h = direction === 'UP' ? priceChange24h : -priceChange24h;
                reversionReturn24h = direction === 'UP' ? -priceChange24h : priceChange24h;
            }

            outcomes.push({
                timestamp: end.t,
                direction,
                spikePercent: change * 100,
                priceAtSpike: end.p,
                priceAfter1h: price1h,
                priceAfter24h: price24h,
                momentumReturn1h,
                momentumReturn24h,
                reversionReturn1h,
                reversionReturn24h,
            });
        }
    }

    return outcomes;
}

function calculateMetrics(
    outcomes: TradeOutcome[],
    getReturn: (o: TradeOutcome) => number | null
): StrategyMetrics {
    const validOutcomes = outcomes.filter((o) => getReturn(o) !== null);
    const returns = validOutcomes.map((o) => getReturn(o)!);

    if (returns.length === 0) {
        return {
            trades: 0,
            wins: 0,
            winRate: 0,
            totalReturn: 0,
            avgReturn: 0,
            bestTrade: 0,
            worstTrade: 0,
        };
    }

    const wins = returns.filter((r) => r > 0).length;

    return {
        trades: returns.length,
        wins,
        winRate: wins / returns.length,
        totalReturn: returns.reduce((a, b) => a + b, 0),
        avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
        bestTrade: Math.max(...returns),
        worstTrade: Math.min(...returns),
    };
}

function analyzeStrategies(outcomes: TradeOutcome[]): StrategyComparison {
    return {
        momentum1h: calculateMetrics(outcomes, (o) => o.momentumReturn1h),
        momentum24h: calculateMetrics(outcomes, (o) => o.momentumReturn24h),
        reversion1h: calculateMetrics(outcomes, (o) => o.reversionReturn1h),
        reversion24h: calculateMetrics(outcomes, (o) => o.reversionReturn24h),
    };
}

function printReport(
    marketName: string,
    outcomes: TradeOutcome[],
    comparison: StrategyComparison
): void {
    console.log('\n' + '='.repeat(70));
    console.log('ANOMALY OUTCOME ANALYSIS');
    console.log('='.repeat(70));
    console.log(`Market: ${marketName}`);
    console.log(`Anomalies found: ${outcomes.length}`);

    if (outcomes.length === 0) {
        console.log('\nNo anomalies detected with current thresholds.');
        return;
    }

    // Print individual trades
    console.log('\nINDIVIDUAL TRADES:');
    for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i];
        const time = new Date(o.timestamp * 1000).toISOString().slice(0, 16);
        const spike = `${o.direction} ${o.spikePercent > 0 ? '+' : ''}${o.spikePercent.toFixed(1)}%`;
        const ret1h =
            o.momentumReturn1h !== null
                ? `${o.momentumReturn1h >= 0 ? '+' : ''}${(o.momentumReturn1h * 100).toFixed(1)}%`
                : 'N/A';
        const ret24h =
            o.momentumReturn24h !== null
                ? `${o.momentumReturn24h >= 0 ? '+' : ''}${(o.momentumReturn24h * 100).toFixed(1)}%`
                : 'N/A';

        const emoji1h =
            o.momentumReturn1h !== null ? (o.momentumReturn1h > 0 ? '✅' : '❌') : '⏳';
        const emoji24h =
            o.momentumReturn24h !== null ? (o.momentumReturn24h > 0 ? '✅' : '❌') : '⏳';

        console.log(
            `  #${(i + 1).toString().padStart(2)}  ${time}  ${spike.padEnd(12)}  ` +
                `1h: ${ret1h.padStart(7)} ${emoji1h}  24h: ${ret24h.padStart(7)} ${emoji24h}`
        );
    }

    // Print strategy comparison
    console.log('\n' + '-'.repeat(70));
    console.log('STRATEGY COMPARISON (if we traded every signal):');
    console.log('-'.repeat(70));

    const formatMetrics = (m: StrategyMetrics): string => {
        if (m.trades === 0) return 'No data'.padEnd(25);
        return (
            `${m.wins}/${m.trades} (${(m.winRate * 100).toFixed(0)}%) ` +
            `${m.totalReturn >= 0 ? '+' : ''}${(m.totalReturn * 100).toFixed(1)}%`
        ).padEnd(25);
    };

    console.log('                    │ MOMENTUM              │ MEAN REVERSION');
    console.log('────────────────────┼───────────────────────┼───────────────────────');
    console.log(
        `1h Exit             │ ${formatMetrics(comparison.momentum1h)}│ ${formatMetrics(comparison.reversion1h)}`
    );
    console.log(
        `24h Exit            │ ${formatMetrics(comparison.momentum24h)}│ ${formatMetrics(comparison.reversion24h)}`
    );

    // Find best strategy
    const strategies = [
        { name: 'Momentum 1h', m: comparison.momentum1h },
        { name: 'Momentum 24h', m: comparison.momentum24h },
        { name: 'Mean Reversion 1h', m: comparison.reversion1h },
        { name: 'Mean Reversion 24h', m: comparison.reversion24h },
    ].filter((s) => s.m.trades > 0);

    if (strategies.length > 0) {
        const best = strategies.reduce((a, b) =>
            a.m.totalReturn > b.m.totalReturn ? a : b
        );

        console.log('\n' + '-'.repeat(70));
        if (best.m.totalReturn > 0) {
            console.log(
                `✅ BEST STRATEGY: ${best.name} with ${(best.m.totalReturn * 100).toFixed(1)}% total return`
            );
            console.log(`   Win rate: ${(best.m.winRate * 100).toFixed(0)}%`);
            console.log(
                `   Best trade: +${(best.m.bestTrade * 100).toFixed(1)}%, Worst: ${(best.m.worstTrade * 100).toFixed(1)}%`
            );
        } else {
            console.log('❌ No profitable strategy found with current thresholds.');
            console.log('   Consider adjusting spike threshold or exit timing.');
        }
    }
}

async function findHighVolumeMarket(): Promise<{ tokenId: string; name: string } | null> {
    try {
        const url = `${GAMMA_API}/events?active=true&closed=false&limit=20&order=volume24hr&ascending=false`;
        const response = await fetch(url);
        const events = await response.json();

        for (const event of events) {
            if (!event.markets || !Array.isArray(event.markets)) continue;

            for (const m of event.markets) {
                // Skip sports/entertainment
                const question = (m.question || '').toLowerCase();
                if (
                    question.includes('nfl') ||
                    question.includes('nba') ||
                    question.includes('game')
                ) {
                    continue;
                }

                try {
                    const tokenIds = JSON.parse(m.clobTokenIds || '[]');
                    if (tokenIds.length > 0) {
                        return {
                            tokenId: tokenIds[0],
                            name: m.question || event.title,
                        };
                    }
                } catch {
                    continue;
                }
            }
        }
    } catch (error) {
        console.error('Error finding market:', error);
    }
    return null;
}

async function findPoliticalMarkets(): Promise<{ tokenId: string; name: string }[]> {
    const markets: { tokenId: string; name: string }[] = [];

    try {
        const url = `${GAMMA_API}/events?active=true&closed=false&limit=50&order=volume24hr&ascending=false`;
        const response = await fetch(url);
        const events = await response.json();

        const politicalKeywords = [
            'trump',
            'fed',
            'tariff',
            'president',
            'resign',
            'war',
            'ceasefire',
            'election',
            'congress',
            'senate',
        ];

        for (const event of events) {
            if (!event.markets || !Array.isArray(event.markets)) continue;

            for (const m of event.markets) {
                const question = (m.question || '').toLowerCase();

                // Check if it's a political market
                if (!politicalKeywords.some((kw) => question.includes(kw))) {
                    continue;
                }

                // Skip sports
                if (
                    question.includes('nfl') ||
                    question.includes('nba') ||
                    question.includes('game')
                ) {
                    continue;
                }

                try {
                    const tokenIds = JSON.parse(m.clobTokenIds || '[]');
                    if (tokenIds.length > 0) {
                        markets.push({
                            tokenId: tokenIds[0],
                            name: m.question.slice(0, 60),
                        });
                    }
                } catch {
                    continue;
                }
            }
        }
    } catch (error) {
        console.error('Error finding markets:', error);
    }

    return markets;
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║              ANOMALY OUTCOME ANALYSIS                              ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');

    const args = process.argv.slice(2);
    let tokenId: string | null = null;
    let marketName = 'Unknown Market';
    let days = 1;
    let multiMarket = false;

    for (const arg of args) {
        if (arg.startsWith('--token=')) {
            tokenId = arg.split('=')[1];
        } else if (arg.startsWith('--days=')) {
            days = parseInt(arg.split('=')[1], 10);
        } else if (arg === '--multi') {
            multiMarket = true;
        }
    }

    if (multiMarket) {
        // Analyze multiple political markets
        console.log('\nFinding political markets...');
        const markets = await findPoliticalMarkets();
        console.log(`Found ${markets.length} political markets`);

        const allOutcomes: TradeOutcome[] = [];
        let marketsWithData = 0;

        for (const market of markets.slice(0, 15)) {
            // Limit to 15 markets
            const history = await fetchPriceHistory(market.tokenId, days);
            if (history.length < 10) continue;

            const outcomes = findAnomalies(history, 5, 0.05);
            if (outcomes.length > 0) {
                console.log(`  ${market.name}: ${outcomes.length} anomalies`);
                allOutcomes.push(...outcomes);
                marketsWithData++;
            }

            await new Promise((r) => setTimeout(r, 200)); // Rate limit
        }

        console.log(`\nTotal: ${allOutcomes.length} anomalies across ${marketsWithData} markets`);

        const comparison = analyzeStrategies(allOutcomes);
        printReport('AGGREGATE: Political Markets', allOutcomes, comparison);
        return;
    }

    // Single market analysis
    if (!tokenId) {
        console.log('\nNo token specified, finding high-volume market...');
        const market = await findHighVolumeMarket();
        if (market) {
            tokenId = market.tokenId;
            marketName = market.name;
            console.log(`Found: ${marketName}`);
        } else {
            console.log('Could not find a suitable market.');
            process.exit(1);
        }
    }

    console.log(`\nFetching ${days} day(s) of price history...`);
    const history = await fetchPriceHistory(tokenId, days);
    console.log(`Got ${history.length} data points`);

    if (history.length < 10) {
        console.log('Insufficient data for analysis.');
        process.exit(1);
    }

    console.log('\nScanning for price spikes (≥5% in 5 min)...');
    const outcomes = findAnomalies(history, 5, 0.05);
    console.log(`Found ${outcomes.length} anomalies`);

    const comparison = analyzeStrategies(outcomes);
    printReport(marketName, outcomes, comparison);
}

main().catch(console.error);

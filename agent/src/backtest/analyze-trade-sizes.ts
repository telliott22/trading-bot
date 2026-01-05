#!/usr/bin/env npx ts-node

import * as dotenv from 'dotenv';
dotenv.config();

interface Trade {
    trade_time: string;
    wallet: string;
    side: 'BUY' | 'SELL';
    shares: number;
    usdc_amount: number;
    price: number;
}

async function analyze() {
    const response = await fetch(
        'https://api.dune.com/api/v1/query/6465163/results?limit=10000',
        { headers: { 'x-dune-api-key': process.env.DUNE_API_KEY || '' } }
    );
    const data = await response.json();
    const trades: Trade[] = data.result?.rows || [];

    const spikeTime = new Date('2026-01-03T09:30:00Z');
    const beforeSpike = trades.filter(t => new Date(t.trade_time) < spikeTime);
    const buysBeforeSpike = beforeSpike.filter(t => t.side === 'BUY');

    const amounts = buysBeforeSpike.map(t => t.usdc_amount).sort((a, b) => a - b);

    console.log('='.repeat(70));
    console.log('TRADE SIZE DISTRIBUTION - ALL BUYS BEFORE SPIKE');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Total BUY trades before spike: ${amounts.length}`);
    console.log('');

    const sum = amounts.reduce((a, b) => a + b, 0);
    const avg = sum / amounts.length;
    const median = amounts[Math.floor(amounts.length / 2)];
    const min = amounts[0];
    const max = amounts[amounts.length - 1];

    console.log('STATISTICS:');
    console.log(`  Min trade:    $${min.toFixed(2)}`);
    console.log(`  Median trade: $${median.toFixed(2)}`);
    console.log(`  Average:      $${avg.toFixed(2)}`);
    console.log(`  Max trade:    $${max.toFixed(2)}`);
    console.log(`  Total volume: $${sum.toFixed(2)}`);
    console.log('');

    const p75 = amounts[Math.floor(amounts.length * 0.75)];
    const p90 = amounts[Math.floor(amounts.length * 0.90)];
    const p95 = amounts[Math.floor(amounts.length * 0.95)];
    const p99 = amounts[Math.floor(amounts.length * 0.99)];

    console.log('PERCENTILES:');
    console.log(`  75th percentile: $${p75.toFixed(2)}`);
    console.log(`  90th percentile: $${p90.toFixed(2)}`);
    console.log(`  95th percentile: $${p95.toFixed(2)}`);
    console.log(`  99th percentile: $${p99.toFixed(2)}`);
    console.log('');

    // Distribution buckets
    const buckets = [
        { label: '$0-1', min: 0, max: 1 },
        { label: '$1-5', min: 1, max: 5 },
        { label: '$5-10', min: 5, max: 10 },
        { label: '$10-25', min: 10, max: 25 },
        { label: '$25-50', min: 25, max: 50 },
        { label: '$50-100', min: 50, max: 100 },
        { label: '$100-500', min: 100, max: 500 },
        { label: '$500+', min: 500, max: Infinity },
    ];

    console.log('DISTRIBUTION:');
    for (const bucket of buckets) {
        const count = amounts.filter(a => a >= bucket.min && a < bucket.max).length;
        const pct = ((count / amounts.length) * 100).toFixed(1);
        const bar = '#'.repeat(Math.round(count / amounts.length * 40));
        console.log(`  ${bucket.label.padEnd(10)} ${count.toString().padStart(4)} trades (${pct.padStart(5)}%) ${bar}`);
    }
    console.log('');

    // Now specifically look at low-price buys (< 25%)
    const lowPriceBuys = buysBeforeSpike.filter(t => t.price < 0.25);
    const lowAmounts = lowPriceBuys.map(t => t.usdc_amount).sort((a, b) => a - b);

    console.log('='.repeat(70));
    console.log('LOW PRICE BUYS ONLY (< 25% price) - The "insider" zone');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Total low-price BUY trades: ${lowAmounts.length}`);

    if (lowAmounts.length > 0) {
        const lowSum = lowAmounts.reduce((a, b) => a + b, 0);
        const lowAvg = lowSum / lowAmounts.length;
        const lowMedian = lowAmounts[Math.floor(lowAmounts.length / 2)];
        const lowP90 = lowAmounts[Math.floor(lowAmounts.length * 0.90)];
        const lowP95 = lowAmounts[Math.floor(lowAmounts.length * 0.95)];

        console.log('');
        console.log('STATISTICS (low-price buys only):');
        console.log(`  Median trade: $${lowMedian.toFixed(2)}`);
        console.log(`  Average:      $${lowAvg.toFixed(2)}`);
        console.log(`  90th pctl:    $${lowP90.toFixed(2)}`);
        console.log(`  95th pctl:    $${lowP95.toFixed(2)}`);
        console.log(`  Max trade:    $${lowAmounts[lowAmounts.length - 1].toFixed(2)}`);
        console.log('');

        console.log('WHERE DO THE "SUSPICIOUS" TRADES RANK?');
        console.log('');

        const suspiciousAmounts = [423.72, 315.54, 225.00, 214.41, 131.03, 100.40, 98.00, 95.76];
        for (const amt of suspiciousAmounts) {
            const rank = lowAmounts.filter(a => a >= amt).length;
            const pctl = ((1 - rank / lowAmounts.length) * 100).toFixed(1);
            console.log(`  $${amt.toFixed(2).padStart(7)} -> Top ${rank}/${lowAmounts.length} (${pctl}th percentile)`);
        }
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('CONCLUSION');
    console.log('='.repeat(70));
    console.log('');
}

analyze().catch(console.error);

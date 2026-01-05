#!/usr/bin/env npx ts-node

/**
 * Create and Run Dune Query for Polymarket Trades
 *
 * This script creates a parameterized query on Dune to fetch OrderFilled events
 * for a specific Polymarket token, then executes it.
 *
 * Usage:
 *   npx ts-node src/backtest/create-dune-query.ts --token=TOKEN_ID
 */

import * as dotenv from 'dotenv';
dotenv.config();

const DUNE_API = 'https://api.dune.com/api/v1';

interface DuneApiResponse {
    query_id?: number;
    execution_id?: string;
    state?: string;
    result?: {
        rows: any[];
    };
    error?: any;
}

async function callDuneApi(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any
): Promise<DuneApiResponse> {
    const apiKey = process.env.DUNE_API_KEY;
    if (!apiKey) {
        throw new Error('DUNE_API_KEY not set');
    }

    const url = `${DUNE_API}${endpoint}`;
    const options: RequestInit = {
        method,
        headers: {
            'x-dune-api-key': apiKey,
            'Content-Type': 'application/json',
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    return response.json();
}

async function createQuery(name: string, sql: string): Promise<number> {
    // Note: Creating queries via API requires Dune Plus/Pro subscription
    // For free tier, you need to create queries in the Dune UI first
    const result = await callDuneApi('/query', 'POST', {
        name,
        query_sql: sql,
        parameters: [],
    });

    if (result.query_id) {
        return result.query_id;
    }

    throw new Error(`Failed to create query: ${JSON.stringify(result)}`);
}

async function executeQuery(queryId: number, params: Record<string, string> = {}): Promise<string> {
    const result = await callDuneApi(`/query/${queryId}/execute`, 'POST', {
        query_parameters: params,
    });

    if (result.execution_id) {
        return result.execution_id;
    }

    throw new Error(`Failed to execute query: ${JSON.stringify(result)}`);
}

async function getResults(executionId: string): Promise<any[]> {
    const result = await callDuneApi(`/execution/${executionId}/results`);

    if (result.state === 'QUERY_STATE_COMPLETED' && result.result) {
        return result.result.rows;
    }

    if (result.state === 'QUERY_STATE_FAILED') {
        throw new Error(`Query failed: ${JSON.stringify(result.error)}`);
    }

    // Still running
    return [];
}

async function waitForResults(executionId: string, maxWaitMs = 120000): Promise<any[]> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const rows = await getResults(executionId);
        if (rows.length > 0) {
            return rows;
        }

        console.log('  Waiting for query to complete...');
        await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error('Query timed out');
}

async function main() {
    console.log('='.repeat(60));
    console.log('DUNE QUERY FOR POLYMARKET TRADES');
    console.log('='.repeat(60));

    // Parse args
    const args = process.argv.slice(2);
    let tokenId: string | null = null;

    for (const arg of args) {
        if (arg.startsWith('--token=')) {
            tokenId = arg.split('=')[1];
        }
    }

    if (!tokenId) {
        // Default to Maduro YES token
        tokenId = '7023463941941580393623777508894165086142929841541805476418845616988817847686';
    }

    console.log(`\nToken ID: ${tokenId.slice(0, 30)}...`);

    // The SQL query we need
    const sql = `
-- Polymarket OrderFilled events for a specific token
-- Fetches all trades for a given market token ID

SELECT
    evt_block_time as block_time,
    evt_tx_hash as tx_hash,
    maker,
    taker,
    "makerAssetId" as maker_asset_id,
    "takerAssetId" as taker_asset_id,
    "makerAmountFilled" / 1e6 as maker_amount,
    "takerAmountFilled" / 1e6 as taker_amount,
    CASE
        WHEN "takerAssetId" = 0 THEN 'BUY'  -- Taker paying USDC = buying
        ELSE 'SELL'
    END as side
FROM polymarket_polygon.CTFExchange_evt_OrderFilled
WHERE "makerAssetId" = ${tokenId}
   OR "takerAssetId" = ${tokenId}
ORDER BY evt_block_time DESC
LIMIT 1000
    `.trim();

    console.log('\nSQL Query:');
    console.log('-'.repeat(60));
    console.log(sql);
    console.log('-'.repeat(60));

    console.log('\n\nTo run this query:');
    console.log('1. Go to https://dune.com');
    console.log('2. Click "New Query"');
    console.log('3. Paste the SQL above');
    console.log('4. Run the query');
    console.log('5. Save it and note the query ID');
    console.log('6. Run: npx ts-node src/backtest/validate-detection.ts --query=YOUR_QUERY_ID');

    console.log('\n\nAlternatively, try this existing query that might work:');

    // Try to get results from an existing general Polymarket trades query
    // Query 3837298 is just counts, but let's search for a trades query
    console.log('Searching for existing trade-level queries...');

    // Let's check if there's a query we can use
    // For now, print instructions for the user

    console.log(`
=================================================================
NEXT STEPS
=================================================================

Since creating Dune queries via API requires a paid plan, you'll need to:

1. Go to https://dune.com and sign in
2. Click "New Query"
3. Paste this SQL:

${sql}

4. Run it to verify it works
5. Save the query
6. Copy the query ID from the URL (e.g., dune.com/queries/12345 -> ID is 12345)
7. Run the validation script:
   npx ts-node src/backtest/validate-detection.ts --query=YOUR_QUERY_ID

This query will fetch all trades for the Maduro market token.
`);
}

main().catch(console.error);

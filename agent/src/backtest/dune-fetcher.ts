/**
 * Dune Analytics Fetcher
 * Fetches historical trade data from Dune Analytics for backtesting
 *
 * Dune has on-chain OrderFilled events with every Polymarket trade,
 * including wallet addresses, timestamps, sizes, and prices.
 */

import * as dotenv from 'dotenv';
dotenv.config();

const DUNE_API = 'https://api.dune.com/api/v1';

export interface DuneTrade {
    block_time: string; // ISO timestamp
    token_id: string; // Market token ID
    maker: string; // Wallet address
    taker: string; // Wallet address
    size: number; // Trade size in shares
    price: number; // Execution price (0-1)
    side: 'BUY' | 'SELL';
    tx_hash?: string;
}

export interface DuneQueryResult<T> {
    execution_id: string;
    query_id: number;
    state: 'QUERY_STATE_PENDING' | 'QUERY_STATE_EXECUTING' | 'QUERY_STATE_COMPLETED' | 'QUERY_STATE_FAILED';
    result?: {
        rows: T[];
        metadata: {
            column_names: string[];
            result_set_bytes: number;
            total_row_count: number;
        };
    };
    error?: string;
}

export class DuneFetcher {
    private apiKey: string;

    constructor() {
        const apiKey = process.env.DUNE_API_KEY;
        if (!apiKey) {
            throw new Error('DUNE_API_KEY not found in environment variables');
        }
        this.apiKey = apiKey;
    }

    /**
     * Execute a Dune query with parameters
     */
    async executeQuery(
        queryId: number,
        params: Record<string, string> = {}
    ): Promise<string> {
        const url = `${DUNE_API}/query/${queryId}/execute`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'x-dune-api-key': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query_parameters: params,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Dune execute failed: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return data.execution_id;
    }

    /**
     * Get execution status and results
     */
    async getExecutionResults<T>(executionId: string): Promise<DuneQueryResult<T>> {
        const url = `${DUNE_API}/execution/${executionId}/results`;

        const response = await fetch(url, {
            headers: {
                'x-dune-api-key': this.apiKey,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Dune results failed: ${response.status} - ${error}`);
        }

        return response.json();
    }

    /**
     * Get latest results from a query (if already executed)
     */
    async getLatestResults<T>(queryId: number): Promise<T[]> {
        const url = `${DUNE_API}/query/${queryId}/results`;

        const response = await fetch(url, {
            headers: {
                'x-dune-api-key': this.apiKey,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Dune latest results failed: ${response.status} - ${error}`);
        }

        const data: DuneQueryResult<T> = await response.json();

        if (data.state !== 'QUERY_STATE_COMPLETED' || !data.result) {
            throw new Error(`Query not complete: ${data.state}`);
        }

        return data.result.rows;
    }

    /**
     * Execute query and wait for results (with polling)
     */
    async executeAndWait<T>(
        queryId: number,
        params: Record<string, string> = {},
        maxWaitMs: number = 120000
    ): Promise<T[]> {
        console.log(`Executing Dune query ${queryId}...`);

        const executionId = await this.executeQuery(queryId, params);
        console.log(`Execution ID: ${executionId}`);

        const startTime = Date.now();
        const pollInterval = 2000; // 2 seconds

        while (Date.now() - startTime < maxWaitMs) {
            await this.sleep(pollInterval);

            const result = await this.getExecutionResults<T>(executionId);

            if (result.state === 'QUERY_STATE_COMPLETED') {
                if (!result.result) {
                    throw new Error('Query completed but no results');
                }
                console.log(`Got ${result.result.rows.length} rows`);
                return result.result.rows;
            }

            if (result.state === 'QUERY_STATE_FAILED') {
                throw new Error(`Query failed: ${result.error}`);
            }

            console.log(`  Status: ${result.state}...`);
        }

        throw new Error(`Query timed out after ${maxWaitMs}ms`);
    }

    /**
     * Fetch trades for a specific token ID and date range
     *
     * This requires a Dune query that accepts token_id, start_date, end_date parameters.
     * You'll need to create this query on Dune first.
     */
    async fetchTradesForToken(
        tokenId: string,
        startDate: Date,
        endDate: Date,
        queryId: number
    ): Promise<DuneTrade[]> {
        const params = {
            token_id: tokenId,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
        };

        const rows = await this.executeAndWait<any>(queryId, params);

        // Map to DuneTrade format (column names depend on your query)
        return rows.map((row) => ({
            block_time: row.block_time || row.evt_block_time,
            token_id: row.token_id || row.tokenID || tokenId,
            maker: row.maker || row.maker_address,
            taker: row.taker || row.taker_address,
            size: parseFloat(row.size || row.makerAmountFilled || '0'),
            price: parseFloat(row.price || '0'),
            side: this.determineSide(row),
            tx_hash: row.tx_hash || row.evt_tx_hash,
        }));
    }

    /**
     * Determine buy/sell side from row data
     */
    private determineSide(row: any): 'BUY' | 'SELL' {
        if (row.side !== undefined) {
            // If side is numeric (0 = BUY, 1 = SELL) or string
            if (row.side === 0 || row.side === 'BUY' || row.side === 'buy') {
                return 'BUY';
            }
            return 'SELL';
        }
        // Default to BUY if unknown
        return 'BUY';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Sample Dune SQL query for Polymarket trades:
 *
 * SELECT
 *   evt_block_time as block_time,
 *   "tokenID" as token_id,
 *   maker,
 *   taker,
 *   "makerAmountFilled" / 1e6 as size,
 *   "price" / 1e18 as price,
 *   CASE WHEN side = 0 THEN 'BUY' ELSE 'SELL' END as side,
 *   evt_tx_hash as tx_hash
 * FROM polymarket_polygon.CTFExchange_evt_OrderFilled
 * WHERE "tokenID" = '{{token_id}}'
 *   AND evt_block_time >= TIMESTAMP '{{start_date}}'
 *   AND evt_block_time <= TIMESTAMP '{{end_date}}'
 * ORDER BY evt_block_time
 */

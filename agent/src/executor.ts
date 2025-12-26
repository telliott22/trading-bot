/**
 * Automated Trade Executor
 * Executes trades on Polymarket when leader markets resolve
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import { MarketRelation } from './types';
import * as dotenv from 'dotenv';
dotenv.config();

// Configuration
const CLOB_HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon mainnet

// Safety limits
const MAX_POSITION_SIZE_USD = 50; // Maximum USD per trade
const MIN_POSITION_SIZE_USD = 5;  // Minimum to make trade worthwhile
const DEFAULT_POSITION_SIZE_USD = 20; // Default position size

interface ExecutionResult {
    success: boolean;
    orderId?: string;
    error?: string;
    price?: number;
    size?: number;
}

interface TokenInfo {
    tokenId: string;
    outcome: string;
    price: number;
}

export class Executor {
    private client: ClobClient | null = null;
    private enabled: boolean = false;
    private wallet: Wallet | null = null;

    constructor() {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;

        if (!privateKey) {
            console.log('⚠ Executor disabled: POLYMARKET_PRIVATE_KEY not set');
            console.log('  To enable auto-execution, add your wallet private key to .env');
            return;
        }

        try {
            // Create wallet from private key
            this.wallet = new Wallet(privateKey);
            console.log(`✓ Wallet loaded: ${this.wallet.address}`);

            // Initialize CLOB client
            const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, this.wallet);

            // Create or derive API credentials
            const apiCreds = await tempClient.createOrDeriveApiKey();

            // Initialize trading client with credentials
            // Signature type 0 = standard EOA wallet
            this.client = new ClobClient(
                CLOB_HOST,
                CHAIN_ID,
                this.wallet,
                apiCreds,
                0 // signature type for EOA
            );

            this.enabled = true;
            console.log('✓ Polymarket executor initialized');
            console.log(`  Max position size: $${MAX_POSITION_SIZE_USD}`);
        } catch (error) {
            console.error('✗ Failed to initialize executor:', error);
            this.enabled = false;
        }
    }

    /**
     * Check if executor is ready to trade
     */
    public isEnabled(): boolean {
        return this.enabled && this.client !== null;
    }

    /**
     * Get the token ID for a market's YES or NO outcome
     */
    private async getTokenId(marketId: string, outcome: 'YES' | 'NO'): Promise<TokenInfo | null> {
        try {
            const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`);
            if (!response.ok) {
                console.error(`Failed to fetch market ${marketId}`);
                return null;
            }

            const market = await response.json();

            if (!market.tokens || !Array.isArray(market.tokens)) {
                console.error(`Market ${marketId} has no tokens`);
                return null;
            }

            // Find the token for the desired outcome
            const token = market.tokens.find((t: any) => {
                const tokenOutcome = t.outcome?.toLowerCase();
                return outcome === 'YES'
                    ? (tokenOutcome === 'yes' || t.outcome_id === 0)
                    : (tokenOutcome === 'no' || t.outcome_id === 1);
            });

            if (!token) {
                console.error(`Could not find ${outcome} token for market ${marketId}`);
                return null;
            }

            return {
                tokenId: token.token_id,
                outcome: outcome,
                price: parseFloat(token.price || '0.5'),
            };
        } catch (error) {
            console.error(`Error fetching token for market ${marketId}:`, error);
            return null;
        }
    }

    /**
     * Calculate position size based on confidence and price
     */
    private calculatePositionSize(confidence: number, price: number): number {
        // Scale position by confidence (0.5 to 1.0 maps to 50% to 100% of default)
        const confidenceMultiplier = 0.5 + (confidence * 0.5);

        // Adjust for price - smaller position when price is already high (less upside)
        const priceMultiplier = price < 0.3 ? 1.2 : price > 0.7 ? 0.8 : 1.0;

        let size = DEFAULT_POSITION_SIZE_USD * confidenceMultiplier * priceMultiplier;

        // Clamp to limits
        size = Math.max(MIN_POSITION_SIZE_USD, Math.min(MAX_POSITION_SIZE_USD, size));

        return Math.round(size * 100) / 100; // Round to cents
    }

    /**
     * Execute a trade on the follower market
     */
    public async executeFollowerTrade(
        relation: MarketRelation,
        leaderOutcome: 'YES' | 'NO'
    ): Promise<ExecutionResult> {
        if (!this.isEnabled()) {
            return {
                success: false,
                error: 'Executor not enabled - missing POLYMARKET_PRIVATE_KEY',
            };
        }

        // Determine what to bet on follower based on relationship and leader outcome
        let followerBet: 'YES' | 'NO';

        if (relation.relationshipType === 'SAME_OUTCOME') {
            // Same outcome: leader YES → follower YES, leader NO → follower NO
            followerBet = leaderOutcome;
        } else if (relation.relationshipType === 'DIFFERENT_OUTCOME') {
            // Different outcome: leader YES → follower NO, leader NO → follower YES
            followerBet = leaderOutcome === 'YES' ? 'NO' : 'YES';
        } else {
            return {
                success: false,
                error: `Invalid relationship type for trading: ${relation.relationshipType}`,
            };
        }

        const followerId = relation.followerId;
        if (!followerId) {
            return {
                success: false,
                error: 'No follower market ID found',
            };
        }

        console.log(`\n🎯 EXECUTING TRADE`);
        console.log(`   Follower market: ${followerId}`);
        console.log(`   Action: BUY ${followerBet}`);

        // Get token info for the follower market
        const tokenInfo = await this.getTokenId(followerId, followerBet);
        if (!tokenInfo) {
            return {
                success: false,
                error: `Could not get token ID for ${followerBet} on market ${followerId}`,
            };
        }

        console.log(`   Token ID: ${tokenInfo.tokenId.substring(0, 20)}...`);
        console.log(`   Current price: ${(tokenInfo.price * 100).toFixed(1)}¢`);

        // Calculate position size
        const positionSize = this.calculatePositionSize(relation.confidenceScore, tokenInfo.price);
        console.log(`   Position size: $${positionSize}`);

        // Calculate number of shares: size / price
        const shares = positionSize / tokenInfo.price;

        try {
            // Create the order
            // Use a slightly aggressive price to ensure fill (market order style)
            const orderPrice = Math.min(0.99, tokenInfo.price + 0.02);

            const order = await this.client!.createOrder({
                tokenID: tokenInfo.tokenId,
                price: orderPrice,
                side: Side.BUY,
                size: shares,
                feeRateBps: 0,
                nonce: 0,
            });

            // Post the order as Fill-Or-Kill (immediate execution)
            const response = await this.client!.postOrder(order, OrderType.FOK);

            if (response.success) {
                console.log(`   ✓ ORDER FILLED: ${response.orderID || 'success'}`);
                return {
                    success: true,
                    orderId: response.orderID,
                    price: orderPrice,
                    size: positionSize,
                };
            } else {
                console.log(`   ✗ Order failed: ${response.errorMsg || 'unknown error'}`);
                return {
                    success: false,
                    error: response.errorMsg || 'Order rejected',
                };
            }
        } catch (error: any) {
            console.error(`   ✗ Execution error:`, error.message || error);
            return {
                success: false,
                error: error.message || 'Execution failed',
            };
        }
    }

    /**
     * Check wallet balance
     */
    public async getBalance(): Promise<number | null> {
        if (!this.client) return null;

        try {
            // This would need the actual balance check implementation
            // For now, return null to indicate unknown
            return null;
        } catch (error) {
            return null;
        }
    }
}

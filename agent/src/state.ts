/**
 * State Management Module
 * Persists tracked opportunities and caches for intelligent incremental scanning
 */

import * as fs from 'fs';
import * as path from 'path';
import { MarketRelation, SingleMarket } from './types';

const STATE_FILE = path.join(__dirname, '..', 'predictions_state.json');

// Cache configuration
const MARKET_RETENTION_DAYS = 30; // Keep market data for 30 days after end date

// ============================================
// Cache Types for Intelligent Scanning
// ============================================

export interface SeenMarket {
    question: string;
    endTime: string;
    firstSeen: string;
}

export interface AnalyzedPair {
    result: 'SAME_OUTCOME' | 'DIFFERENT_OUTCOME' | 'UNRELATED' | 'SAME_EVENT_REJECT';
    confidence: number;
    analyzedAt: string;
}

export interface CacheState {
    seenMarkets: { [marketId: string]: SeenMarket };
    analyzedPairs: { [pairId: string]: AnalyzedPair };  // pairId = sorted "id1-id2"
    embeddings: { [marketId: string]: number[] };
}

export interface TrackedOpportunity {
    id: string;  // market1.id-market2.id
    relation: MarketRelation;
    leaderResolved: boolean;
    leaderOutcome?: 'YES' | 'NO';
    notifiedAt?: string;
    createdAt: string;
    // Threshold tracking for near-certainty alerts
    thresholdTriggered?: boolean;
    thresholdTriggeredAt?: string;
    thresholdPrice?: number;
    status: 'active' | 'threshold_triggered' | 'resolved';
    seriesId?: string;  // For grouping date-series markets (e.g., "Maduro out by Jan/Feb/Mar")
}

export interface OpportunityState {
    opportunities: TrackedOpportunity[];
    lastChecked: string;
    // Cache for intelligent incremental scanning
    cache?: CacheState;
}

export class State {
    private state: OpportunityState;

    constructor() {
        this.state = this.loadState();
    }

    private loadState(): OpportunityState {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = fs.readFileSync(STATE_FILE, 'utf-8');
                const state = JSON.parse(data);
                // Ensure cache exists (for backward compatibility)
                if (!state.cache) {
                    state.cache = this.createEmptyCache();
                }
                return state;
            }
        } catch (error) {
            console.error('Error loading state file, starting fresh:', error);
        }
        return {
            opportunities: [],
            lastChecked: new Date().toISOString(),
            cache: this.createEmptyCache(),
        };
    }

    private createEmptyCache(): CacheState {
        return {
            seenMarkets: {},
            analyzedPairs: {},
            embeddings: {},
        };
    }

    public saveState(): void {
        try {
            this.state.lastChecked = new Date().toISOString();
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
        } catch (error) {
            console.error('Error saving state file:', error);
        }
    }

    public addOpportunity(relation: MarketRelation): boolean {
        const id = `${relation.market1.id}-${relation.market2.id}`;

        // Check if already tracked
        if (this.state.opportunities.some(opp => opp.id === id)) {
            return false;
        }

        this.state.opportunities.push({
            id,
            relation,
            leaderResolved: false,
            createdAt: new Date().toISOString(),
            status: 'active',
            seriesId: relation.seriesId,
        });

        this.saveState();
        return true;
    }

    public markLeaderResolved(id: string, outcome: 'YES' | 'NO'): void {
        const opp = this.state.opportunities.find(o => o.id === id);
        if (opp) {
            opp.leaderResolved = true;
            opp.leaderOutcome = outcome;
            opp.notifiedAt = new Date().toISOString();
            opp.status = 'resolved';
            this.saveState();
        }
    }

    public getUnresolvedOpportunities(): TrackedOpportunity[] {
        return this.state.opportunities.filter(opp => !opp.leaderResolved);
    }

    public hasOpportunity(id: string): boolean {
        return this.state.opportunities.some(opp => opp.id === id);
    }

    public getOpportunityCount(): number {
        return this.state.opportunities.length;
    }

    // ============================================
    // Threshold Tracking Methods
    // ============================================

    /**
     * Get opportunities that are active and haven't been threshold-triggered
     */
    public getActiveOpportunities(): TrackedOpportunity[] {
        return this.state.opportunities.filter(opp =>
            opp.status === 'active' && !opp.leaderResolved && !opp.thresholdTriggered
        );
    }

    /**
     * Mark an opportunity as threshold-triggered (leader hit 90%+)
     */
    public markThresholdTriggered(id: string, price: number): void {
        const opp = this.state.opportunities.find(o => o.id === id);
        if (opp) {
            opp.thresholdTriggered = true;
            opp.thresholdTriggeredAt = new Date().toISOString();
            opp.thresholdPrice = price;
            opp.status = 'threshold_triggered';
            this.saveState();
        }
    }

    /**
     * Get all opportunities in a series (for cascade alerts)
     */
    public getOpportunitiesInSeries(seriesId: string): TrackedOpportunity[] {
        if (!seriesId) return [];
        return this.state.opportunities.filter(opp => opp.seriesId === seriesId);
    }

    /**
     * Get count of threshold-triggered opportunities
     */
    public getTriggeredCount(): number {
        return this.state.opportunities.filter(opp => opp.status === 'threshold_triggered').length;
    }

    public getUnresolvedCount(): number {
        return this.getUnresolvedOpportunities().length;
    }

    // ============================================
    // Market Cache Methods
    // ============================================

    /**
     * Check if a market has been seen before
     */
    public isMarketNew(marketId: string): boolean {
        return !this.state.cache?.seenMarkets[marketId];
    }

    /**
     * Mark a market as seen (called for all markets in current scan)
     */
    public markMarketSeen(market: SingleMarket): void {
        if (!this.state.cache) {
            this.state.cache = this.createEmptyCache();
        }

        // Only add if not already seen
        if (!this.state.cache.seenMarkets[market.id]) {
            this.state.cache.seenMarkets[market.id] = {
                question: market.question,
                endTime: market.endTime || '',
                firstSeen: new Date().toISOString(),
            };
        }
    }

    /**
     * Get count of seen markets
     */
    public getSeenMarketCount(): number {
        return Object.keys(this.state.cache?.seenMarkets || {}).length;
    }

    // ============================================
    // Pair Analysis Cache Methods
    // ============================================

    /**
     * Create a canonical pair ID (sorted alphabetically for consistency)
     */
    private canonicalPairId(id1: string, id2: string): string {
        return [id1, id2].sort().join('-');
    }

    /**
     * Check if a pair has already been analyzed
     */
    public isPairAnalyzed(id1: string, id2: string): boolean {
        const pairId = this.canonicalPairId(id1, id2);
        return !!this.state.cache?.analyzedPairs[pairId];
    }

    /**
     * Get cached pair analysis result
     */
    public getPairResult(id1: string, id2: string): AnalyzedPair | null {
        const pairId = this.canonicalPairId(id1, id2);
        return this.state.cache?.analyzedPairs[pairId] || null;
    }

    /**
     * Save pair analysis result to cache
     */
    public savePairResult(
        id1: string,
        id2: string,
        result: AnalyzedPair['result'],
        confidence: number
    ): void {
        if (!this.state.cache) {
            this.state.cache = this.createEmptyCache();
        }

        const pairId = this.canonicalPairId(id1, id2);
        this.state.cache.analyzedPairs[pairId] = {
            result,
            confidence,
            analyzedAt: new Date().toISOString(),
        };
    }

    /**
     * Get count of analyzed pairs
     */
    public getAnalyzedPairCount(): number {
        return Object.keys(this.state.cache?.analyzedPairs || {}).length;
    }

    // ============================================
    // Embedding Cache Methods
    // ============================================

    /**
     * Get cached embedding for a market
     */
    public getEmbedding(marketId: string): number[] | null {
        return this.state.cache?.embeddings[marketId] || null;
    }

    /**
     * Save embedding to cache
     */
    public saveEmbedding(marketId: string, embedding: number[]): void {
        if (!this.state.cache) {
            this.state.cache = this.createEmptyCache();
        }
        this.state.cache.embeddings[marketId] = embedding;
    }

    /**
     * Get count of cached embeddings
     */
    public getEmbeddingCount(): number {
        return Object.keys(this.state.cache?.embeddings || {}).length;
    }

    // ============================================
    // Cache Cleanup Methods
    // ============================================

    /**
     * Remove stale cache entries for markets that have ended
     */
    public cleanupEndedMarkets(): void {
        if (!this.state.cache) return;

        const now = Date.now();
        const retentionMs = MARKET_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        let cleanedMarkets = 0;
        let cleanedPairs = 0;
        let cleanedEmbeddings = 0;

        // Find markets to remove (ended + retention period passed)
        const marketsToRemove = new Set<string>();
        for (const [marketId, market] of Object.entries(this.state.cache.seenMarkets)) {
            if (market.endTime) {
                const endTime = new Date(market.endTime).getTime();
                if (endTime + retentionMs < now) {
                    marketsToRemove.add(marketId);
                }
            }
        }

        // Remove stale markets
        for (const marketId of marketsToRemove) {
            delete this.state.cache.seenMarkets[marketId];
            cleanedMarkets++;

            // Also remove embedding
            if (this.state.cache.embeddings[marketId]) {
                delete this.state.cache.embeddings[marketId];
                cleanedEmbeddings++;
            }
        }

        // Remove pairs involving removed markets
        for (const pairId of Object.keys(this.state.cache.analyzedPairs)) {
            const [id1, id2] = pairId.split('-');
            if (marketsToRemove.has(id1) || marketsToRemove.has(id2)) {
                delete this.state.cache.analyzedPairs[pairId];
                cleanedPairs++;
            }
        }

        if (cleanedMarkets > 0 || cleanedPairs > 0 || cleanedEmbeddings > 0) {
            console.log(`Cache cleanup: removed ${cleanedMarkets} markets, ${cleanedPairs} pairs, ${cleanedEmbeddings} embeddings`);
        }
    }

    /**
     * Get cache statistics for logging
     */
    public getCacheStats(): { markets: number; pairs: number; embeddings: number } {
        return {
            markets: this.getSeenMarketCount(),
            pairs: this.getAnalyzedPairCount(),
            embeddings: this.getEmbeddingCount(),
        };
    }
}

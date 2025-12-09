/**
 * Leader Resolution Monitor
 * Polls Polymarket API to detect when leader markets resolve
 * and triggers notifications for trading action
 */

import { State, TrackedOpportunity } from './state';
import { Notifier } from './notifications';

interface PolymarketMarketResponse {
    id: string;
    question: string;
    closed: boolean;
    resolved: boolean;
    outcome?: string;  // "Yes" or "No" when resolved
    winning_outcome?: string;
}

export class Monitor {
    private state: State;
    private notifier: Notifier;

    constructor(state: State, notifier: Notifier) {
        this.state = state;
        this.notifier = notifier;
    }

    /**
     * Check if a specific market has resolved
     */
    private async fetchMarketStatus(marketId: string): Promise<PolymarketMarketResponse | null> {
        try {
            const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`);
            if (!response.ok) {
                console.error(`Failed to fetch market ${marketId}: ${response.status}`);
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching market ${marketId}:`, error);
            return null;
        }
    }

    /**
     * Parse the winning outcome from Polymarket response
     */
    private parseOutcome(market: PolymarketMarketResponse): 'YES' | 'NO' | null {
        // Polymarket uses various fields for outcome
        const outcome = market.outcome || market.winning_outcome;
        if (!outcome) return null;

        const normalized = outcome.toLowerCase();
        if (normalized === 'yes' || normalized === '1' || normalized === 'true') {
            return 'YES';
        }
        if (normalized === 'no' || normalized === '0' || normalized === 'false') {
            return 'NO';
        }
        return null;
    }

    /**
     * Check all unresolved opportunities for leader resolution
     */
    public async checkLeaderResolutions(): Promise<number> {
        const unresolved = this.state.getUnresolvedOpportunities();

        if (unresolved.length === 0) {
            return 0;
        }

        console.log(`\nChecking ${unresolved.length} leader markets for resolution...`);

        let resolvedCount = 0;

        for (const opp of unresolved) {
            const leaderId = opp.relation.leaderId;
            if (!leaderId) {
                console.warn(`  ⚠ Opportunity ${opp.id} has no leaderId, skipping`);
                continue;
            }

            const market = await this.fetchMarketStatus(leaderId);
            if (!market) {
                continue;
            }

            // Check if market is resolved/closed
            if (market.resolved || market.closed) {
                const outcome = this.parseOutcome(market);

                if (outcome) {
                    console.log(`  🎯 LEADER RESOLVED: ${market.question} → ${outcome}`);

                    // Send notification
                    await this.notifier.notifyLeaderResolved(opp.relation, outcome);

                    // Update state
                    this.state.markLeaderResolved(opp.id, outcome);
                    resolvedCount++;
                } else {
                    console.log(`  ⚠ Market ${leaderId} closed but outcome unclear`);
                }
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (resolvedCount > 0) {
            console.log(`\n✓ ${resolvedCount} leader market(s) resolved, notifications sent.`);
        } else {
            console.log(`  No leader resolutions detected.`);
        }

        return resolvedCount;
    }
}

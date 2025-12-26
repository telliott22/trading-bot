/**
 * Leader Resolution Monitor
 * Polls Polymarket API to detect when leader markets resolve
 * and triggers notifications + automated execution
 */

import { State, TrackedOpportunity } from './state';
import { Notifier } from './notifications';
import { Executor } from './executor';

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
    private executor: Executor | null = null;
    private autoExecute: boolean = false;

    constructor(state: State, notifier: Notifier, executor?: Executor) {
        this.state = state;
        this.notifier = notifier;

        if (executor) {
            this.executor = executor;
            this.autoExecute = executor.isEnabled();
            if (this.autoExecute) {
                console.log('✓ Auto-execution ENABLED - trades will execute automatically');
            }
        }
    }

    /**
     * Enable or disable auto-execution
     */
    public setAutoExecute(enabled: boolean): void {
        if (enabled && (!this.executor || !this.executor.isEnabled())) {
            console.warn('Cannot enable auto-execute: Executor not initialized');
            return;
        }
        this.autoExecute = enabled;
        console.log(`Auto-execution ${enabled ? 'ENABLED' : 'DISABLED'}`);
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

        // Only log occasionally to reduce noise (every ~5 minutes)
        const shouldLog = Math.random() < 0.1;
        if (shouldLog) {
            console.log(`Checking ${unresolved.length} leader markets for resolution...`);
        }

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
                    console.log(`\n  🎯 LEADER RESOLVED: ${market.question}`);
                    console.log(`     Outcome: ${outcome}`);

                    // Determine action based on relationship
                    const action = this.getTradeAction(opp.relation.relationshipType, outcome);
                    console.log(`     Signal: ${action} on follower`);

                    // AUTO-EXECUTE if enabled
                    if (this.autoExecute && this.executor) {
                        console.log(`\n  🤖 AUTO-EXECUTING TRADE...`);

                        const result = await this.executor.executeFollowerTrade(opp.relation, outcome);

                        if (result.success) {
                            console.log(`  ✓ Trade executed: $${result.size} at ${(result.price! * 100).toFixed(1)}¢`);

                            // Send success notification
                            await this.notifier.notifyTradeExecuted(
                                opp.relation,
                                outcome,
                                result.size!,
                                result.price!
                            );
                        } else {
                            console.log(`  ✗ Trade failed: ${result.error}`);

                            // Send failure notification but still notify about the signal
                            await this.notifier.notifyLeaderResolved(opp.relation, outcome);
                            await this.notifier.notifyStatus(`⚠️ Auto-trade failed: ${result.error}`);
                        }
                    } else {
                        // Just send notification for manual trading
                        await this.notifier.notifyLeaderResolved(opp.relation, outcome);
                    }

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
            console.log(`\n✓ ${resolvedCount} leader market(s) resolved.`);
        }
        // Don't log "no resolutions" - too noisy with 60s polling

        return resolvedCount;
    }

    /**
     * Get human-readable trade action
     */
    private getTradeAction(relationshipType: string, leaderOutcome: 'YES' | 'NO'): string {
        if (relationshipType === 'SAME_OUTCOME') {
            return `BUY ${leaderOutcome}`;
        } else if (relationshipType === 'DIFFERENT_OUTCOME') {
            return leaderOutcome === 'YES' ? 'BUY NO' : 'BUY YES';
        }
        return 'NO ACTION';
    }
}

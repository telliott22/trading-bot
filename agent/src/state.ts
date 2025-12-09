/**
 * State Management Module
 * Persists tracked opportunities to JSON file for monitoring leader resolutions
 */

import * as fs from 'fs';
import * as path from 'path';
import { MarketRelation } from './types';

const STATE_FILE = path.join(__dirname, '..', 'predictions_state.json');

export interface TrackedOpportunity {
    id: string;  // market1.id-market2.id
    relation: MarketRelation;
    leaderResolved: boolean;
    leaderOutcome?: 'YES' | 'NO';
    notifiedAt?: string;
    createdAt: string;
}

export interface OpportunityState {
    opportunities: TrackedOpportunity[];
    lastChecked: string;
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
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading state file, starting fresh:', error);
        }
        return {
            opportunities: [],
            lastChecked: new Date().toISOString(),
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

    public getUnresolvedCount(): number {
        return this.getUnresolvedOpportunities().length;
    }
}

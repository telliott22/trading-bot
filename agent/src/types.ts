export interface SingleMarket {
    id: string;
    slug?: string; // For Polymarket URLs
    question: string;
    description: string;
    startTime: string; // ISO string
    endTime: string;   // ISO string
    outcomes: string[];
    volume: number;
    tokens?: any[]; // Keep flexible for now
    // Price data for mispricing detection
    yesPrice?: number; // 0.0 to 1.0
    noPrice?: number;  // 0.0 to 1.0
}

export interface Trade {
    marketId: string;
    amount: number; // USD value
    timestamp: number;
    side: 'BUY' | 'SELL';
    outcomeIndex: number;
}

export interface MarketRelation {
    market1: EnrichedMarket;
    market2: EnrichedMarket;
    relationshipType: 'SAME_OUTCOME' | 'DIFFERENT_OUTCOME' | 'UNRELATED' | 'SAME_EVENT_REJECT';
    confidenceScore: number; // 0.0 to 1.0
    rationale: string;
    tradingRationale?: string; // "If leader resolves YES, then..."
    expectedEdge?: string; // Description of market inefficiency
    leaderId?: string;
    followerId?: string;
    timeGap?: string; // e.g. "12 days" or "4 hours"
    timeGapDays?: number; // Numeric for filtering/sorting
    timestamp: string;
}

// Internal type for clustering/processing
export interface EnrichedMarket extends SingleMarket {
    clusterId?: string;
    category?: string;
    embedding?: number[]; // If we used embeddings (optional for now)
}

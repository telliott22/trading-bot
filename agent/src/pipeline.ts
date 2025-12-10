import OpenAI from 'openai';
import { Langfuse } from 'langfuse';
import { SingleMarket, MarketRelation, EnrichedMarket } from './types';
import { SemanticClustering } from './clustering';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Pipeline for analyzing market relationships
 * Per specs: "Relationship Discovery MCP finds same-outcome (correlated)
 * and different-outcome (anti-correlated) links with confidence scores"
 */
export class Pipeline {
    private openai: OpenAI;
    private clustering: SemanticClustering;
    private langfuse: Langfuse | null = null;

    // === SPEC REQUIREMENTS ===
    private readonly MIN_TIME_GAP_DAYS = 0;  // No minimum gap - show all opportunities
    private readonly MIN_CONFIDENCE = 0.5;   // Only save signals with confidence ≥0.5
    private readonly MAX_PAIRS_PER_CLUSTER = 10; // Limit API calls

    constructor() {
        const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn("No API Key found for OpenRouter/OpenAI. Pipeline will not work correctly.");
        }
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: apiKey || "sk-or-...",
            defaultHeaders: {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Polymarket Agent",
            },
        });
        this.clustering = new SemanticClustering();

        // Initialize Langfuse for tracing
        if (process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY) {
            this.langfuse = new Langfuse({
                secretKey: process.env.LANGFUSE_SECRET_KEY,
                publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
            });
            console.log('✓ Langfuse tracing enabled');
        } else {
            console.log('⚠ Langfuse not configured (set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY)');
        }
    }

    /**
     * Cluster markets using semantic clustering
     */
    public async clusterMarkets(markets: SingleMarket[]): Promise<Map<string, EnrichedMarket[]>> {
        return this.clustering.clusterMarkets(markets);
    }

    /**
     * Calculate time gap between two markets in days
     */
    private calculateTimeGap(m1: EnrichedMarket, m2: EnrichedMarket): { days: number; gap: string; leaderId: string; followerId: string } | null {
        if (!m1.endTime || !m2.endTime) return null;

        const t1 = new Date(m1.endTime).getTime();
        const t2 = new Date(m2.endTime).getTime();
        const diffMs = Math.abs(t1 - t2);
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        const displayDays = Math.floor(diffDays);
        const displayHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        // Leader = earlier end time, Follower = later end time
        const leaderId = t1 < t2 ? m1.id : m2.id;
        const followerId = t1 < t2 ? m2.id : m1.id;

        return {
            days: diffDays,
            gap: `${displayDays}d ${displayHours}h`,
            leaderId,
            followerId,
        };
    }

    /**
     * Find relationships within a cluster, pre-filtering by time gap
     */
    public async findRelationships(markets: EnrichedMarket[]): Promise<MarketRelation[]> {
        const relationships: MarketRelation[] = [];
        let pairCount = 0;
        let skippedTimeGap = 0;

        console.log(`\nAnalyzing ${markets.length} markets for relationships...`);

        for (let i = 0; i < markets.length && pairCount < this.MAX_PAIRS_PER_CLUSTER; i++) {
            for (let j = i + 1; j < markets.length && pairCount < this.MAX_PAIRS_PER_CLUSTER; j++) {
                const m1 = markets[i];
                const m2 = markets[j];

                // CRITICAL: Pre-filter by time gap (per specs)
                const timeInfo = this.calculateTimeGap(m1, m2);
                if (!timeInfo || timeInfo.days < this.MIN_TIME_GAP_DAYS) {
                    skippedTimeGap++;
                    continue; // Skip pairs without meaningful time gap
                }

                // Analyze pair with LLM
                console.log(`Analyzing pair: ${m1.id} vs ${m2.id} (gap: ${timeInfo.gap})`);
                const rel = await this.analyzePair(m1, m2, timeInfo);

                // Only save actionable signals:
                // - Not UNRELATED (no relationship)
                // - Not SAME_EVENT_REJECT (same event, different timeframes - no trading window!)
                // - Confidence ≥ 0.5
                const isActionable = rel &&
                    rel.relationshipType !== 'UNRELATED' &&
                    rel.relationshipType !== 'SAME_EVENT_REJECT' &&
                    rel.confidenceScore >= this.MIN_CONFIDENCE;

                if (isActionable) {
                    relationships.push(rel);
                    console.log(`  ✓ ${rel.relationshipType} (${rel.confidenceScore}) - ACTIONABLE`);
                } else if (rel) {
                    const reason = rel.relationshipType === 'SAME_EVENT_REJECT'
                        ? 'same event, no trade window'
                        : 'not actionable';
                    console.log(`  ✗ ${rel.relationshipType} (${reason})`);
                }

                pairCount++;
            }
        }

        console.log(`\nResults: ${relationships.length} actionable signals (skipped ${skippedTimeGap} pairs with <${this.MIN_TIME_GAP_DAYS}d gap)\n`);
        return relationships;
    }

    /**
     * Analyze a market pair with trading-focused LLM prompt
     */
    private async analyzePair(
        m1: EnrichedMarket,
        m2: EnrichedMarket,
        timeInfo: { days: number; gap: string; leaderId: string; followerId: string }
    ): Promise<MarketRelation | null> {
        // Create Langfuse trace for this analysis
        const trace = this.langfuse?.trace({
            name: 'analyze-market-pair',
            metadata: {
                market1Id: m1.id,
                market2Id: m2.id,
                timeGapDays: timeInfo.days,
            },
        });

        try {
            // Determine which is leader/follower
            const leader = timeInfo.leaderId === m1.id ? m1 : m2;
            const follower = timeInfo.leaderId === m1.id ? m2 : m1;

            const systemPrompt = "You are an expert prediction market analyst. Your goal is to identify high-confidence trading opportunities using the leader-follower strategy. Be conservative - only mark relationships as SAME_OUTCOME or DIFFERENT_OUTCOME if you are confident there is a real, actionable relationship.";

            // === CRITICAL: Distinguish same-event vs different-event pairs ===
            const userPrompt = `You are an expert prediction market trader. Analyze these two markets for a **leader-follower trading strategy**.

**REJECT THESE (NOT ACTIONABLE):**
❌ SAME EVENT with different timeframes: "X by 2025?" vs "X by 2026?" - both resolve together
❌ MUTUALLY EXCLUSIVE outcomes of same event: "680-719 tweets" vs "720-759 tweets" - only one can be YES
❌ Different numeric ranges of same metric: views, prices, counts with different brackets

**ACCEPT THESE (ACTIONABLE):**
✅ DIFFERENT EVENTS with causal link: "Fed cuts Dec?" vs "Fed cuts Jan?" - separate meetings
✅ Prerequisite → Outcome: "Win primary?" vs "Win general?" - first enables second

**LEADER MARKET** (resolves FIRST on ${new Date(leader.endTime).toLocaleDateString()}):
- Question: ${leader.question}
- YES price: ${leader.yesPrice?.toFixed(2) || 'unknown'}

**FOLLOWER MARKET** (resolves LATER on ${new Date(follower.endTime).toLocaleDateString()}):
- Question: ${follower.question}
- YES price: ${follower.yesPrice?.toFixed(2) || 'unknown'}

**TIME GAP**: ${Math.floor(timeInfo.days)} days

**KEY QUESTION:** If leader resolves YES, does the follower market STAY OPEN with uncertainty? Or is the follower's outcome already determined/excluded?

**OUTPUT RULES:**
- "SAME_EVENT_REJECT": Same event OR mutually exclusive brackets → NOT actionable
- "SAME_OUTCOME": Different events, leader YES → bet follower YES
- "DIFFERENT_OUTCOME": Different events, leader YES → bet follower NO
- "UNRELATED": No causal relationship

**Output JSON only:**
{
    "isSameEvent": true/false,
    "areMutuallyExclusive": true/false,
    "relationshipType": "SAME_EVENT_REJECT" | "SAME_OUTCOME" | "DIFFERENT_OUTCOME" | "UNRELATED",
    "confidenceScore": 0.0-1.0,
    "tradingRationale": "If leader resolves YES, [action]. If leader resolves NO, [action].",
    "expectedEdge": "Why this trade profits from information asymmetry"
}`;

            // Create generation span for the LLM call
            const generation = trace?.generation({
                name: 'market-pair-analysis',
                model: 'openai/gpt-4-turbo',
                input: {
                    system: systemPrompt,
                    user: userPrompt,
                },
                metadata: {
                    leaderQuestion: leader.question,
                    followerQuestion: follower.question,
                    leaderEndDate: leader.endTime,
                    followerEndDate: follower.endTime,
                },
            });

            const response = await this.openai.chat.completions.create({
                model: "openai/gpt-4-turbo",  // Use GPT-4 for better analysis
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.3, // Lower temperature for more consistent analysis
            });

            let content = response.choices[0].message?.content || "{}";

            // Sanitize: Remove markdown code blocks if present
            content = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();

            const result = JSON.parse(content);

            // End generation with output
            generation?.end({
                output: result,
                usage: {
                    promptTokens: response.usage?.prompt_tokens,
                    completionTokens: response.usage?.completion_tokens,
                    totalTokens: response.usage?.total_tokens,
                },
            });

            // Score the trace based on actionability
            const isActionable = result.relationshipType !== 'UNRELATED' &&
                result.relationshipType !== 'SAME_EVENT_REJECT' &&
                result.confidenceScore >= this.MIN_CONFIDENCE;

            trace?.score({
                name: 'actionable',
                value: isActionable ? 1 : 0,
            });

            trace?.score({
                name: 'confidence',
                value: result.confidenceScore || 0,
            });

            return {
                market1: m1,
                market2: m2,
                relationshipType: result.relationshipType || 'UNRELATED',
                confidenceScore: result.confidenceScore || 0,
                rationale: result.tradingRationale || result.rationale || '',
                tradingRationale: result.tradingRationale,
                expectedEdge: result.expectedEdge,
                leaderId: timeInfo.leaderId,
                followerId: timeInfo.followerId,
                timeGap: timeInfo.gap,
                timeGapDays: timeInfo.days,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error("Error analyzing pair:", error);
            trace?.score({
                name: 'error',
                value: 1,
                comment: String(error),
            });
            return null;
        }
    }

    /**
     * Flush Langfuse events (call at end of pipeline run)
     */
    public async flush(): Promise<void> {
        if (this.langfuse) {
            await this.langfuse.flushAsync();
        }
    }
}

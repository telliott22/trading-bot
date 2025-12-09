import OpenAI from 'openai';
import { SingleMarket, EnrichedMarket } from './types';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Semantic Clustering Module
 * Per specs: "Clustering MCP uses a vector-space model over market text 
 * to group markets into topical clusters, aiming for cluster size K ≈ N/10"
 */

export class SemanticClustering {
    private openai: OpenAI;

    constructor() {
        const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPENAI_API_KEY;
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: apiKey || "sk-or-...",
        });
    }

    /**
     * Generate embeddings for market questions using OpenAI
     */
    public async generateEmbeddings(texts: string[]): Promise<number[][]> {
        try {
            // Use OpenAI embeddings API via OpenRouter
            const response = await this.openai.embeddings.create({
                model: "openai/text-embedding-3-small",
                input: texts,
            });

            return response.data.map(d => d.embedding);
        } catch (error) {
            console.warn("Embedding API not available, falling back to keyword clustering");
            return [];
        }
    }

    /**
     * Simple K-means clustering implementation for embeddings
     */
    private kMeansClustering(embeddings: number[][], k: number, maxIterations = 10): number[] {
        const n = embeddings.length;
        const dim = embeddings[0]?.length || 0;

        if (n === 0 || dim === 0 || k >= n) {
            return embeddings.map((_, i) => i % Math.max(1, k));
        }

        // Initialize centroids randomly
        const usedIndices = new Set<number>();
        const centroids: number[][] = [];
        while (centroids.length < k) {
            const idx = Math.floor(Math.random() * n);
            if (!usedIndices.has(idx)) {
                usedIndices.add(idx);
                centroids.push([...embeddings[idx]]);
            }
        }

        let assignments = new Array(n).fill(0);

        for (let iter = 0; iter < maxIterations; iter++) {
            // Assign each point to nearest centroid
            const newAssignments = embeddings.map((emb) => {
                let minDist = Infinity;
                let minIdx = 0;
                for (let c = 0; c < k; c++) {
                    const dist = this.euclideanDistance(emb, centroids[c]);
                    if (dist < minDist) {
                        minDist = dist;
                        minIdx = c;
                    }
                }
                return minIdx;
            });

            // Update centroids
            for (let c = 0; c < k; c++) {
                const clusterPoints = embeddings.filter((_, i) => newAssignments[i] === c);
                if (clusterPoints.length > 0) {
                    for (let d = 0; d < dim; d++) {
                        centroids[c][d] = clusterPoints.reduce((sum, p) => sum + p[d], 0) / clusterPoints.length;
                    }
                }
            }

            assignments = newAssignments;
        }

        return assignments;
    }

    private euclideanDistance(a: number[], b: number[]): number {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += (a[i] - b[i]) ** 2;
        }
        return Math.sqrt(sum);
    }

    /**
     * Cluster markets using semantic embeddings
     * Falls back to improved keyword clustering if embeddings fail
     */
    public async clusterMarkets(markets: SingleMarket[]): Promise<Map<string, EnrichedMarket[]>> {
        const clusters = new Map<string, EnrichedMarket[]>();

        console.log(`Clustering ${markets.length} markets...`);

        // Try embedding-based clustering first
        const embeddings = await this.generateEmbeddings(markets.map(m => m.question));

        if (embeddings.length === markets.length) {
            // Use embedding-based clustering
            const k = Math.max(5, Math.floor(markets.length / 10)); // K ≈ N/10 per specs
            console.log(`Using semantic clustering with K=${k} clusters`);

            const assignments = this.kMeansClustering(embeddings, k);

            markets.forEach((m, i) => {
                const clusterId = `cluster_${assignments[i]}`;
                const cluster = clusters.get(clusterId) || [];
                cluster.push({ ...m, clusterId, embedding: embeddings[i] });
                clusters.set(clusterId, cluster);
            });

            // Label clusters after grouping
            await this.labelClusters(clusters);

        } else {
            // Fallback to improved keyword clustering
            console.log("Using fallback keyword clustering");
            this.keywordClustering(markets, clusters);
        }

        // Log cluster sizes
        console.log(`Created ${clusters.size} clusters:`);
        for (const [id, members] of clusters) {
            console.log(`  ${id}: ${members.length} markets`);
        }

        return clusters;
    }

    /**
     * Improved keyword clustering - groups by key entities/topics
     */
    private keywordClustering(markets: SingleMarket[], clusters: Map<string, EnrichedMarket[]>) {
        // Extract key topic from question
        const extractTopic = (question: string): string => {
            const q = question.toLowerCase();

            // Topic patterns with priority
            const patterns: [RegExp, string][] = [
                [/\bfed\b|federal reserve|interest rate|rate cut|rate hike|fomc/i, 'fed_rates'],
                [/\btrump\b/i, 'trump'],
                [/\bbiden\b/i, 'biden'],
                [/\btime.*person of the year|time 2025/i, 'time_person'],
                [/presidential.*nomin|democratic.*nomin|republican.*nomin/i, 'nominations_2028'],
                [/presidential.*election|win.*president/i, 'election_2028'],
                [/\brecession\b/i, 'recession'],
                [/\binflation\b/i, 'inflation'],
                [/\bceasefire\b|russia.*ukraine|ukraine.*russia/i, 'russia_ukraine'],
                [/\bisrael\b|\bgaza\b|\bnetanyahu\b/i, 'israel_gaza'],
                [/\bchina\b|\bxi\b/i, 'china'],
                [/\bpoland\b|\bportugal\b|\bhonduras\b|\bbrazil\b/i, 'intl_elections'],
                [/\bspacex\b|\bstarship\b/i, 'spacex'],
                [/\bopenai\b|\bgpt\b|\bgemini\b|\bclaude\b/i, 'ai_models'],
                [/\blargest.*company\b|\bmarket cap\b/i, 'market_cap'],
                [/\bmadam.*out\b|\bout.*2025\b|\bout.*2026\b/i, 'leaders_out'],
            ];

            for (const [pattern, topic] of patterns) {
                if (pattern.test(question)) {
                    return topic;
                }
            }

            // Default: extract first noun phrase
            const words = question.replace(/[?]/g, '').split(' ');
            if (words[0].toLowerCase() === 'will' && words.length > 2) {
                return words.slice(1, 3).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
            }

            return 'other';
        };

        markets.forEach(m => {
            const topic = extractTopic(m.question);
            const cluster = clusters.get(topic) || [];
            cluster.push({ ...m, clusterId: topic });
            clusters.set(topic, cluster);
        });
    }

    /**
     * Label clusters using LLM to assign interpretable category
     */
    private async labelClusters(clusters: Map<string, EnrichedMarket[]>) {
        // Per specs: "closed taxonomy including 'politics', 'geopolitics', 'finance', 'crypto', 'sports'"
        const TAXONOMY = ['politics', 'finance', 'geopolitics', 'economy', 'tech', 'ai', 'culture', 'elections', 'other'];

        for (const [clusterId, markets] of clusters) {
            if (markets.length === 0) continue;

            // Sample up to 5 questions for labeling
            const sampleQuestions = markets.slice(0, 5).map(m => m.question).join('\n- ');

            try {
                const response = await this.openai.chat.completions.create({
                    model: "openai/gpt-3.5-turbo",
                    messages: [
                        {
                            role: "system",
                            content: `Classify these prediction market questions into ONE category from: ${TAXONOMY.join(', ')}. Reply with just the category name.`
                        },
                        { role: "user", content: `Questions:\n- ${sampleQuestions}` }
                    ],
                    max_tokens: 20,
                });

                const label = response.choices[0].message?.content?.trim().toLowerCase() || 'other';

                // Apply category to all markets in cluster
                markets.forEach(m => {
                    m.category = TAXONOMY.includes(label) ? label : 'other';
                });

            } catch (error) {
                // Fallback to clusterId as category
                markets.forEach(m => m.category = 'other');
            }
        }
    }
}

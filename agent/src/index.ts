import { PolymarketIngestion } from './ingestion';
import { Pipeline } from './pipeline';
import { Storage } from './storage';
import { Notifier } from './notifications';
import { State } from './state';
import { Monitor } from './monitor';
import { SemanticClustering } from './clustering';
import { SingleMarket, MarketRelation } from './types';

// How often to re-scan for new opportunities (in milliseconds)
const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours (reduced from 6 hours - caching makes this efficient)
const RESOLUTION_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function main() {
    console.log("Starting Polymarket Agent (with intelligent caching)...");

    const ingestion = new PolymarketIngestion();
    const pipeline = new Pipeline();
    const clustering = new SemanticClustering();
    const storage = new Storage('../ui/public/predictions.csv');
    const notifier = new Notifier();
    const state = new State();
    const monitor = new Monitor(state, notifier);

    // Log state and cache statistics
    const cacheStats = state.getCacheStats();
    console.log(`Loaded state:`);
    console.log(`  - Opportunities: ${state.getOpportunityCount()} tracked (${state.getUnresolvedCount()} unresolved)`);
    console.log(`  - Cache: ${cacheStats.markets} markets, ${cacheStats.pairs} pairs, ${cacheStats.embeddings} embeddings`);

    async function runPipelineWithCache(allMarkets: SingleMarket[], newMarketIds: Set<string>) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Running pipeline on ${allMarkets.length} markets (${newMarketIds.size} new)...`);
        console.log(`${'='.repeat(60)}\n`);

        // Generate embeddings with caching
        const { embeddings, cacheHits: embCacheHits, apiCalls: embApiCalls } =
            await clustering.generateEmbeddingsWithCache(allMarkets, state);

        console.log(`Embeddings: ${embCacheHits} cached, ${embApiCalls} API calls`);

        // Cluster markets using the embeddings
        const clusters = await clustering.clusterMarketsWithEmbeddings(allMarkets, embeddings);

        let newOpportunitiesCount = 0;
        let totalCacheHits = 0;
        let totalApiCalls = 0;

        for (const [key, group] of clusters.entries()) {
            console.log(`\nAnalyzing cluster: ${key} (${group.length} markets)`);
            if (group.length > 1) {
                // Use cached relationship finding
                const { relationships, cacheHits, apiCalls } =
                    await pipeline.findRelationshipsWithCache(group, state, newMarketIds);

                totalCacheHits += cacheHits;
                totalApiCalls += apiCalls;

                for (const relation of relationships) {
                    // Create unique ID for this opportunity
                    const oppId = `${relation.market1.id}-${relation.market2.id}`;

                    // Only save and notify if this is a NEW opportunity (check persistent state)
                    if (!state.hasOpportunity(oppId)) {
                        await storage.savePredictions([relation]);

                        // Track in persistent state for resolution monitoring
                        state.addOpportunity(relation);

                        // Send notification for new opportunity
                        await notifier.notifyNewOpportunity(relation);
                        newOpportunitiesCount++;

                        console.log(`  🆕 NEW OPPORTUNITY: ${relation.relationshipType} (${relation.confidenceScore})`);
                    }
                }
            }
        }

        // Cleanup stale cache entries
        state.cleanupEndedMarkets();

        // Save state (includes cache)
        state.saveState();

        // Log final statistics
        const finalCacheStats = state.getCacheStats();
        console.log(`\n${'='.repeat(60)}`);
        console.log(`SCAN COMPLETE`);
        console.log(`  - New opportunities: ${newOpportunitiesCount}`);
        console.log(`  - Pair analysis: ${totalCacheHits} cached, ${totalApiCalls} API calls`);
        console.log(`  - Cache size: ${finalCacheStats.markets} markets, ${finalCacheStats.pairs} pairs`);
        console.log(`${'='.repeat(60)}\n`);

        // Flush Langfuse traces
        await pipeline.flush();

        // Push CSV to GitHub for dashboard access
        await storage.pushToGitHub();

        if (newOpportunitiesCount > 0) {
            await notifier.notifyStatus(`Scan complete: ${newOpportunitiesCount} new opportunities found`);
        } else {
            console.log("No new opportunities found (all cached).");
        }
    }

    async function scan() {
        console.log("\n" + "=".repeat(60));
        console.log("STARTING SCAN");
        console.log("=".repeat(60));

        // Use incremental fetch to identify new markets
        const { allMarkets, newMarkets } = await ingestion.fetchActiveMarketsIncremental(state);

        console.log(`Fetched ${allMarkets.length} active markets (${newMarkets.length} new)`);

        if (allMarkets.length > 0) {
            const newMarketIds = new Set(newMarkets.map(m => m.id));
            await runPipelineWithCache(allMarkets, newMarketIds);
        } else {
            console.log("No markets found.");
        }
    }

    // Initial scan
    await scan();

    // Check for any leader resolutions on startup
    await monitor.checkLeaderResolutions();

    // Check if running as one-shot (cron) or continuous
    const isCronMode = process.env.CRON_MODE === 'true';

    if (isCronMode) {
        console.log("Running in cron mode - exiting after single scan.");
        process.exit(0);
    } else {
        console.log(`\nRunning in continuous mode.`);
        console.log(`  - Opportunity scan: every ${RESCAN_INTERVAL_MS / 1000 / 60 / 60} hours`);
        console.log(`  - Resolution check: every ${RESOLUTION_CHECK_INTERVAL_MS / 1000 / 60} minutes`);

        // Schedule periodic opportunity scans
        setInterval(scan, RESCAN_INTERVAL_MS);

        // Schedule more frequent resolution checks
        setInterval(async () => {
            await monitor.checkLeaderResolutions();
        }, RESOLUTION_CHECK_INTERVAL_MS);

        // Keep process alive
        process.on('SIGINT', () => {
            console.log('\nShutting down agent...');
            state.saveState();
            process.exit(0);
        });
    }
}

main().catch(console.error);

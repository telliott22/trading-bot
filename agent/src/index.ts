import { PolymarketIngestion } from './ingestion';
import { Pipeline } from './pipeline';
import { Storage } from './storage';
import { Notifier } from './notifications';
import { State } from './state';
import { Monitor } from './monitor';
import { SingleMarket, MarketRelation } from './types';

// How often to re-scan for new opportunities (in milliseconds)
const RESCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RESOLUTION_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function main() {
    console.log("Starting Polymarket Agent...");

    const ingestion = new PolymarketIngestion();
    const pipeline = new Pipeline();
    const storage = new Storage('../ui/public/predictions.csv');
    const notifier = new Notifier();
    const state = new State();
    const monitor = new Monitor(state, notifier);

    console.log(`Loaded state: ${state.getOpportunityCount()} tracked opportunities (${state.getUnresolvedCount()} unresolved)`);

    // Track known opportunities to avoid duplicate notifications (in-memory for session)
    const knownOpportunities = new Set<string>();

    async function runPipeline(markets: SingleMarket[]) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Running pipeline on ${markets.length} markets...`);
        console.log(`${'='.repeat(60)}\n`);

        const clusters = await pipeline.clusterMarkets(markets);
        let newOpportunitiesCount = 0;

        for (const [key, group] of clusters.entries()) {
            console.log(`Analyzing cluster: ${key} (${group.length} markets)`);
            if (group.length > 1) {
                const relations = await pipeline.findRelationships(group);

                for (const relation of relations) {
                    // Create unique ID for this opportunity
                    const oppId = `${relation.market1.id}-${relation.market2.id}`;

                    // Only save and notify if this is a NEW opportunity
                    if (!knownOpportunities.has(oppId)) {
                        knownOpportunities.add(oppId);
                        await storage.savePredictions([relation]);

                        // Track in persistent state for resolution monitoring
                        state.addOpportunity(relation);

                        // Send notification for new opportunity
                        await notifier.notifyNewOpportunity(relation);
                        newOpportunitiesCount++;

                        console.log(`  🆕 NEW: ${relation.relationshipType} (${relation.confidenceScore}) - Notified`);
                    }
                }
            }
        }

        console.log(`\n✓ Scan complete. Found ${newOpportunitiesCount} NEW opportunities.\n`);

        if (newOpportunitiesCount > 0) {
            await notifier.notifyStatus(`Scan complete: ${newOpportunitiesCount} new opportunities found`);
        }
    }

    async function scan() {
        console.log("\nFetching active markets from Polymarket...");
        const activeMarkets = await ingestion.fetchActiveMarkets();
        console.log(`Fetched ${activeMarkets.length} active markets.`);

        if (activeMarkets.length > 0) {
            await runPipeline(activeMarkets);
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

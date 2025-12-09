import { PolymarketIngestion } from './ingestion';
import { Pipeline } from './pipeline';
import { Storage } from './storage';
import { SingleMarket } from './types';

async function main() {
    console.log("Starting Polymarket Agent...");

    const ingestion = new PolymarketIngestion();
    const pipeline = new Pipeline();
    const storage = new Storage('../ui/public/predictions.csv');

    // Fetch real markets
    console.log("Fetching active markets from Polymarket...");
    const activeMarkets = await ingestion.fetchActiveMarkets();
    console.log(`Fetched ${activeMarkets.length} active markets.`);

    if (activeMarkets.length > 0) {
        runPipeline(activeMarkets);
    } else {
        console.log("No markets found. Exiting or waiting...");
    }

    // Still connect WS for future real-time updates (optional for this step)
    ingestion.connect();

    async function runPipeline(markets: SingleMarket[]) {
        console.log(`Running pipeline on ${markets.length} markets...`);
        const clusters = await pipeline.clusterMarkets(markets);

        for (const [key, group] of clusters.entries()) {
            console.log(`Analyzing cluster: ${key} (${group.length} markets)`);
            if (group.length > 1) {
                const relations = await pipeline.findRelationships(group);
                if (relations.length > 0) {
                    await storage.savePredictions(relations);
                }
            }
        }
    }
}

main().catch(console.error);

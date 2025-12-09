import WebSocket from 'ws';
import { Trade, SingleMarket } from './types';

export class PolymarketIngestion {
    private ws: WebSocket | null = null;
    private readonly url = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    private onTradeCallback: ((trade: Trade) => void) | null = null;
    private onMarketCallback: ((market: SingleMarket) => void) | null = null;

    constructor() { }

    public async fetchActiveMarkets(): Promise<SingleMarket[]> {
        const collectedMarkets: SingleMarket[] = [];
        let offset = 0;
        const limit = 100;
        const maxPages = 10; // Up to 1000 events

        // === SPEC REQUIREMENTS ===
        const MIN_DAYS_TO_END = 7;   // Focus on markets longer than one week
        const MIN_VOLUME = 10000;    // Ensure liquidity ($10k+)

        // Tag slugs to exclude (from Polymarket's tag system)
        const EXCLUDED_TAG_SLUGS = [
            // Crypto
            'crypto', 'bitcoin', 'ethereum', 'crypto-prices', 'airdrops', 'hit-price',
            // Sports
            'basketball', 'EPL', 'champions-league', 'f1', 'formula1', 'boxing',
            'fifa-world-cup', '2026-fifa-world-cup', 'games', 'nfl', 'nba', 'mlb', 'nhl',
            'soccer', 'tennis', 'ufc', 'golf', 'cowboys-vs-eagles', 'chess'
        ];

        const shouldExcludeEvent = (event: any) => {
            if (!event.tags || !Array.isArray(event.tags)) return false;
            const eventTagSlugs = event.tags.map((t: any) => t.slug?.toLowerCase() || '');
            return EXCLUDED_TAG_SLUGS.some(excluded => eventTagSlugs.includes(excluded.toLowerCase()));
        };

        // Check if market meets time and volume requirements
        const meetsRequirements = (market: any): boolean => {
            // Time horizon filter: market must end >7 days from now
            if (market.endDate) {
                const daysToEnd = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                if (daysToEnd < MIN_DAYS_TO_END) {
                    return false;
                }
            }

            // Volume filter: market must have >$10k volume
            const volume = parseFloat(market.volume || '0');
            if (volume < MIN_VOLUME) {
                return false;
            }

            return true;
        };

        // Extract YES/NO prices from tokens array
        const extractPrices = (market: any): { yesPrice?: number; noPrice?: number } => {
            if (!market.tokens || !Array.isArray(market.tokens) || market.tokens.length < 2) {
                return {};
            }

            // Tokens typically have outcome "Yes" and "No" with price field
            const yesToken = market.tokens.find((t: any) =>
                t.outcome?.toLowerCase() === 'yes' || t.outcome_id === 0
            );
            const noToken = market.tokens.find((t: any) =>
                t.outcome?.toLowerCase() === 'no' || t.outcome_id === 1
            );

            return {
                yesPrice: yesToken?.price ? parseFloat(yesToken.price) : undefined,
                noPrice: noToken?.price ? parseFloat(noToken.price) : undefined,
            };
        };

        console.log(`Fetching events with filters:`);
        console.log(`  - Time horizon: >${MIN_DAYS_TO_END} days to end`);
        console.log(`  - Volume: >$${MIN_VOLUME.toLocaleString()}`);
        console.log(`  - Excluded: Crypto, Sports`);

        try {
            for (let i = 0; i < maxPages; i++) {
                const response = await fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`);
                const events = await response.json();

                if (events.length === 0) break;

                // Filter events by tags
                const filteredEvents = events.filter((e: any) => !shouldExcludeEvent(e));

                // Extract markets from filtered events
                let acceptedCount = 0;
                let rejectedTimeCount = 0;
                let rejectedVolumeCount = 0;

                for (const event of filteredEvents) {
                    if (event.markets && Array.isArray(event.markets)) {
                        for (const m of event.markets) {
                            if (!meetsRequirements(m)) {
                                // Track rejection reasons for logging
                                const daysToEnd = m.endDate ?
                                    (new Date(m.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24) : 0;
                                const volume = parseFloat(m.volume || '0');

                                if (daysToEnd < MIN_DAYS_TO_END) rejectedTimeCount++;
                                if (volume < MIN_VOLUME) rejectedVolumeCount++;
                                continue;
                            }

                            const prices = extractPrices(m);

                            collectedMarkets.push({
                                id: m.id,
                                slug: event.slug,
                                question: m.question,
                                description: m.description || event.description,
                                startTime: m.startDate,
                                endTime: m.endDate,
                                outcomes: JSON.parse(m.outcomes || '[]'),
                                volume: parseFloat(m.volume || '0'),
                                tokens: m.tokens,
                                yesPrice: prices.yesPrice,
                                noPrice: prices.noPrice,
                            });
                            acceptedCount++;
                        }
                    }
                }

                console.log(`Page ${i + 1}: Fetched ${events.length} events → Accepted ${acceptedCount} markets (rejected: ${rejectedTimeCount} time, ${rejectedVolumeCount} volume)`);

                if (collectedMarkets.length >= 100) break; // Limit to prevent API overload
                offset += limit;
            }
        } catch (error) {
            console.error("Error fetching events:", error);
        }

        console.log(`\n✓ Total qualifying markets: ${collectedMarkets.length} (>$${MIN_VOLUME.toLocaleString()}, >${MIN_DAYS_TO_END} days)\n`);
        return collectedMarkets;
    }

    public connect() {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            console.log('Connected to Polymarket WS');
            // Subscribe to trades and markets (Simplified subscription messages)
            // Note: Actual subscription logic depends on Polymarket API specifics.
            // Assuming we listen to a broad channel or specific tickers. 
            // For discovery, we might need to poll the API or listen to a firehose if available.
            // As per specs: "Polymarket websocket... 100% free".
            // We'll try to subscribe to a generic asset stream or similar.

            // Example subscription (adjustment needed based on actual API docs):
            const subParams = {
                type: "subscribe",
                channels: [
                    { name: "price", token_ids: ["21742633143463906290569050155826241533067272736897614950488156847949938836455"] } // Example ticker
                ]
            };
            this.ws?.send(JSON.stringify(subParams));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const message = JSON.parse(data.toString());
                // Handle different message types
                // This is a placeholder for parsing logic
                if (message.type === 'trade') {
                    // Parse trade
                    // const trade: Trade = ...
                    // this.onTradeCallback?.(trade);
                }
            } catch (err) {
                console.error('Error parsing WS message', err);
            }
        });

        this.ws.on('error', (err) => {
            console.error('WS Error', err);
        });

        this.ws.on('close', () => {
            console.log('WS Closed, reconnecting...');
            setTimeout(() => this.connect(), 5000);
        });
    }

    public onTrade(callback: (trade: Trade) => void) {
        this.onTradeCallback = callback;
    }

    public onNewMarket(callback: (market: SingleMarket) => void) {
        this.onMarketCallback = callback;
    }
}

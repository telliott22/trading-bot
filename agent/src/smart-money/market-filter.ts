/**
 * Market Filter
 * Filters markets to only those where insider trading is plausible
 */

import { MarketInfo } from './types';

// Markets where insider trading is plausible
const INSIDER_PLAUSIBLE_TAGS = [
    'politics',
    'geopolitics',
    'elections',
    'regulatory',
    'macro',
    'government',
    'legal',
    'policy',
    'fed',
    'central-bank',
];

// Keywords that indicate insider-plausible markets
const INSIDER_KEYWORDS = [
    // Politics / Government
    'resign',
    'impeach',
    'indicted',
    'charged',
    'arrested',
    'step down',
    'leave office',
    'pardoned',
    'pardon',
    'nominate',
    'confirm',
    'appoint',
    'fire',
    'fired',
    'cabinet',
    'secretary',
    'attorney general',
    'director',
    'chief of staff',
    'ambassador',
    'supreme court',
    'justice',
    // Regulatory / Legal
    'approve',
    'reject',
    'ruling',
    'decision',
    'verdict',
    'sentence',
    'conviction',
    'acquit',
    'fda',
    'sec',
    'ftc',
    'doj',
    'epa',
    'fcc',
    'investigation',
    'lawsuit',
    'settlement',
    'merger',
    'antitrust',
    // Macro / Economic
    'fed',
    'fomc',
    'rate cut',
    'rate hike',
    'interest rate',
    'inflation',
    'cpi',
    'gdp',
    'employment',
    'jobs report',
    'unemployment',
    'recession',
    'stimulus',
    'bailout',
    'default',
    'debt ceiling',
    // Geopolitics / International
    'ceasefire',
    'invade',
    'invasion',
    'war',
    'coup',
    'treaty',
    'agreement',
    'sanction',
    'tariff',
    'trade deal',
    'nato',
    'un',
    'summit',
    'nuclear',
    'missile',
    // Elections
    'election',
    'vote',
    'ballot',
    'primary',
    'caucus',
    'debate',
    'poll',
    'candidate',
    'nominee',
    'electoral',
    'swing state',
    // Crypto
    'bitcoin',
    'btc',
    'ethereum',
    'eth',
    'solana',
    'sol',
    'crypto',
    'token',
    'blockchain',
    'defi',
    'nft',
    'altcoin',
    'stablecoin',
    'usdc',
    'usdt',
    'binance',
    'coinbase',
    'sec crypto',
    'etf',
    'spot etf',
];

// Explicitly exclude (even if in valid category)
const EXCLUDED_PATTERNS = [
    // Sports
    /\bnfl\b/i,
    /\bnba\b/i,
    /\bmlb\b/i,
    /\bnhl\b/i,
    /\bmls\b/i,
    /\bepl\b/i,
    /\bpremier league\b/i,
    /\bla liga\b/i,
    /\bchampions league\b/i,
    /\bsoccer\b/i,
    /\bfootball\b/i,
    /\bbasketball\b/i,
    /\btennis\b/i,
    /\bgolf\b/i,
    /\bufc\b/i,
    /\bmma\b/i,
    /\bboxing\b/i,
    /\bf1\b/i,
    /\bformula 1\b/i,
    /\bracing\b/i,
    /\bsuper bowl\b/i,
    /\bworld cup\b/i,
    /\bworld series\b/i,
    /\bchampionship\b/i,
    /\bplayoff\b/i,
    /\bfinals\b/i,
    /\bmvp\b/i,
    /\bteam\b.*\bwin\b/i,
    /\bwin\b.*\bgame\b/i,
    // Entertainment / Social
    /\btweets?\b/i,
    /\bfollowers?\b/i,
    /\bviews?\b/i,
    /\bsubscribers?\b/i,
    /\byoutube\b/i,
    /\btiktok\b/i,
    /\binstagram\b/i,
    /\bstreamer\b/i,
    /\bmovie\b/i,
    /\bbox office\b/i,
    /\balbum\b/i,
    /\bsong\b/i,
    /\baward show\b/i,
    /\boscars?\b/i,
    /\bgrammys?\b/i,
    /\bemmys?\b/i,
    // Price predictions (speculative, not insider)
    /price.*\$\d/i,
    /\$\d.*price/i,
    /market cap/i,
    /trading volume/i,
    /\bATH\b/i,
    /all.time.high/i,
    // Weather (unpredictable, not insider)
    /\bweather\b/i,
    /\bhurricane\b/i,
    /\bearthquake\b/i,
    /\btemperature\b/i,
];

// High-value keywords that boost priority
const HIGH_PRIORITY_KEYWORDS = [
    'resign',
    'indicted',
    'arrested',
    'fda approve',
    'fed rate',
    'fomc',
    'supreme court',
    'ceasefire',
    'invasion',
    'coup',
];

export class MarketFilter {
    /**
     * Check if a market is plausible for insider trading
     */
    isInsiderPlausible(market: MarketInfo): boolean {
        const question = market.question.toLowerCase();
        const description = (market.description || '').toLowerCase();
        const combined = `${question} ${description}`;

        // First check exclusions
        for (const pattern of EXCLUDED_PATTERNS) {
            if (pattern.test(combined)) {
                return false;
            }
        }

        // Check keywords
        for (const keyword of INSIDER_KEYWORDS) {
            if (combined.includes(keyword.toLowerCase())) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get priority boost for high-value markets
     * Returns multiplier: 1.0 (normal), 1.5 (elevated), 2.0 (high priority)
     */
    getPriorityBoost(market: MarketInfo): number {
        const question = market.question.toLowerCase();

        for (const keyword of HIGH_PRIORITY_KEYWORDS) {
            if (question.includes(keyword.toLowerCase())) {
                return 2.0;
            }
        }

        // Check if it's a near-term event (more likely to have insider info)
        const endDate = new Date(market.endDate);
        const daysUntilEnd = (endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        if (daysUntilEnd < 7) {
            return 1.5;
        }

        return 1.0;
    }

    /**
     * Filter a list of markets to only insider-plausible ones
     */
    filterMarkets(markets: MarketInfo[]): MarketInfo[] {
        return markets.filter((m) => this.isInsiderPlausible(m));
    }

    /**
     * Get market category for logging
     */
    getMarketCategory(market: MarketInfo): string {
        const question = market.question.toLowerCase();

        if (/\b(resign|impeach|indicted|pardon|nominate|appoint)\b/.test(question)) {
            return 'politics';
        }
        if (/\b(fda|sec|ftc|ruling|verdict|lawsuit)\b/.test(question)) {
            return 'regulatory';
        }
        if (/\b(fed|fomc|rate|inflation|gdp|jobs)\b/.test(question)) {
            return 'macro';
        }
        if (/\b(ceasefire|invade|war|coup|treaty|sanction)\b/.test(question)) {
            return 'geopolitics';
        }
        if (/\b(election|vote|ballot|primary|candidate)\b/.test(question)) {
            return 'elections';
        }

        return 'other';
    }
}

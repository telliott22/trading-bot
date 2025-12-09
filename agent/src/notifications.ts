/**
 * Notification Module
 * Sends alerts via Telegram when:
 * 1. New trading opportunity found
 * 2. Leader market resolves (time to trade!)
 */

import { MarketRelation } from './types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export class Notifier {
    private enabled: boolean;

    constructor() {
        this.enabled = !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
        if (this.enabled) {
            console.log('✓ Telegram notifications enabled');
        } else {
            console.log('⚠ Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)');
        }
    }

    /**
     * Send a message via Telegram
     */
    private async send(message: string): Promise<void> {
        if (!this.enabled) return;

        try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                }),
            });
        } catch (error) {
            console.error('Telegram notification failed:', error);
        }
    }

    /**
     * Notify when a new trading opportunity is found
     */
    async notifyNewOpportunity(relation: MarketRelation): Promise<void> {
        const leader = relation.leaderId === relation.market1.id ? relation.market1 : relation.market2;
        const follower = relation.leaderId === relation.market1.id ? relation.market2 : relation.market1;

        const emoji = relation.relationshipType === 'SAME_OUTCOME' ? '📈' : '📉';
        const action = relation.relationshipType === 'SAME_OUTCOME'
            ? 'If YES → Bet YES'
            : 'If YES → Bet NO';

        const message = `
${emoji} *NEW OPPORTUNITY FOUND*

*Leader:* ${leader.question}
*Follower:* ${follower.question}

*Relationship:* ${relation.relationshipType}
*Confidence:* ${(relation.confidenceScore * 100).toFixed(0)}%
*Time Gap:* ${relation.timeGap}

*Strategy:* ${action}
*Edge:* ${relation.expectedEdge || 'See dashboard'}

🔗 [Watch Leader](https://polymarket.com/event/${leader.slug})
🎯 [Trade Follower](https://polymarket.com/event/${follower.slug})
`;

        await this.send(message);
    }

    /**
     * Notify when a leader market has resolved - TIME TO TRADE!
     */
    async notifyLeaderResolved(relation: MarketRelation, leaderOutcome: 'YES' | 'NO'): Promise<void> {
        const leader = relation.leaderId === relation.market1.id ? relation.market1 : relation.market2;
        const follower = relation.leaderId === relation.market1.id ? relation.market2 : relation.market1;

        // Determine what to bet based on relationship and outcome
        let betAction: string;
        if (relation.relationshipType === 'SAME_OUTCOME') {
            betAction = leaderOutcome === 'YES' ? 'BUY YES' : 'BUY NO';
        } else {
            betAction = leaderOutcome === 'YES' ? 'BUY NO' : 'BUY YES';
        }

        const message = `
🚨 *LEADER RESOLVED - TIME TO TRADE!*

*Leader Result:* ${leader.question}
➡️ Resolved: *${leaderOutcome}*

*Action Required:*
🎯 *${betAction}* on follower market:
${follower.question}

*Confidence:* ${(relation.confidenceScore * 100).toFixed(0)}%

👉 [TRADE NOW](https://polymarket.com/event/${follower.slug})
`;

        await this.send(message);
    }

    /**
     * Simple status message
     */
    async notifyStatus(message: string): Promise<void> {
        await this.send(`ℹ️ ${message}`);
    }
}

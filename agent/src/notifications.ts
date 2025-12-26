/**
 * Notification Module
 * Sends alerts via Telegram when:
 * 1. New trading opportunity found
 * 2. Leader market resolves (time to trade!)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { MarketRelation } from './types';

export class Notifier {
    private enabled: boolean;
    private botToken: string;
    private chatId: string;

    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
        this.chatId = process.env.TELEGRAM_CHAT_ID || '';
        this.enabled = !!(this.botToken && this.chatId);

        if (this.enabled) {
            console.log('✓ Telegram notifications enabled');
            console.log(`  Bot token: ${this.botToken.substring(0, 10)}...`);
            console.log(`  Chat ID: ${this.chatId}`);
        } else {
            console.log('⚠ Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)');
            console.log(`  TELEGRAM_BOT_TOKEN: ${this.botToken ? 'set' : 'missing'}`);
            console.log(`  TELEGRAM_CHAT_ID: ${this.chatId ? 'set' : 'missing'}`);
        }
    }

    /**
     * Escape special Markdown characters
     */
    private escapeMarkdown(text: string): string {
        return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }

    /**
     * Send a message via Telegram
     */
    private async send(message: string, useMarkdown: boolean = false): Promise<void> {
        if (!this.enabled) {
            console.log('Telegram disabled, skipping notification');
            return;
        }

        try {
            console.log(`Sending Telegram notification...`);
            const body: any = {
                chat_id: this.chatId,
                text: message,
                disable_web_page_preview: true,
            };

            // Only use parse_mode if explicitly requested (avoids escaping issues)
            if (useMarkdown) {
                body.parse_mode = 'Markdown';
            }

            const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const result = await response.json();
            if (result.ok) {
                console.log('✓ Telegram notification sent successfully');
            } else {
                console.error('✗ Telegram API error:', result);
                // Retry without markdown if parsing failed
                if (result.error_code === 400 && useMarkdown) {
                    console.log('Retrying without Markdown...');
                    await this.send(message.replace(/[*_`\[\]]/g, ''), false);
                }
            }
        } catch (error) {
            console.error('✗ Telegram notification failed:', error);
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

        const message = `${emoji} NEW OPPORTUNITY FOUND

Leader: ${leader.question}
Follower: ${follower.question}

Relationship: ${relation.relationshipType}
Confidence: ${(relation.confidenceScore * 100).toFixed(0)}%
Time Gap: ${relation.timeGap}

Strategy: ${action}

🔗 Leader: https://polymarket.com/event/${leader.slug}
🎯 Follower: https://polymarket.com/event/${follower.slug}

📊 Dashboard: https://trading-bot-hazel.vercel.app/`;

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

        const message = `🚨 LEADER RESOLVED - TIME TO TRADE!

Leader: ${leader.question}
Result: ${leaderOutcome}

ACTION: ${betAction} on follower:
${follower.question}

Confidence: ${(relation.confidenceScore * 100).toFixed(0)}%

👉 TRADE NOW: https://polymarket.com/event/${follower.slug}`;

        await this.send(message);
    }

    /**
     * Simple status message
     */
    async notifyStatus(message: string): Promise<void> {
        await this.send(`ℹ️ ${message}`);
    }
}

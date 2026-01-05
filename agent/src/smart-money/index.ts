#!/usr/bin/env npx ts-node

/**
 * Smart Money Detector - Local Runner
 *
 * Monitors Polymarket for suspicious trading activity that might indicate
 * informed traders ("smart money") before news breaks.
 *
 * Usage:
 *   cd agent
 *   npx ts-node src/smart-money/index.ts
 *
 * Requires in .env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Notifier } from '../notifications';
import { SmartMoneyDetector } from './detector';
import { DEFAULT_CONFIG } from './types';

async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     SMART MONEY DETECTOR v1.0          ║');
    console.log('║     Polymarket Anomaly Detection       ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    // Check environment
    const telegramConfigured = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
    if (!telegramConfigured) {
        console.log('⚠️  Telegram not configured - alerts will only be logged');
        console.log('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
        console.log('');
    }

    // Parse command line args for config overrides
    const args = process.argv.slice(2);
    const config: Partial<typeof DEFAULT_CONFIG> = {};

    for (const arg of args) {
        if (arg.startsWith('--min-trade=')) {
            config.largeTradeMin = parseInt(arg.split('=')[1], 10);
        } else if (arg.startsWith('--min-severity=')) {
            const severity = arg.split('=')[1].toUpperCase();
            if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity)) {
                config.minSeverity = severity as typeof DEFAULT_CONFIG.minSeverity;
            }
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    // Initialize notifier
    const notifier = new Notifier();

    // Create and start detector
    const detector = new SmartMoneyDetector(notifier, config);

    try {
        await detector.start();

        // Send startup notification
        if (telegramConfigured) {
            await notifier.notifyStatus(
                'Smart Money Detector started. Monitoring for suspicious activity...'
            );
        }

        // Keep process alive
        console.log('\nPress Ctrl+C to stop.\n');

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n\nShutting down...');
            detector.stop();

            if (telegramConfigured) {
                await notifier.notifyStatus('Smart Money Detector stopped.');
            }

            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n\nReceived SIGTERM, shutting down...');
            detector.stop();
            process.exit(0);
        });

        // Keep the process running
        await new Promise(() => {});
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

function printHelp() {
    console.log(`
Smart Money Detector - Polymarket Anomaly Detection

Usage:
  npx ts-node src/smart-money/index.ts [options]

Options:
  --min-trade=N      Minimum trade size in USD to alert (default: $5000)
  --min-severity=S   Minimum severity to alert: LOW, MEDIUM, HIGH, CRITICAL
                     (default: MEDIUM)
  --help, -h         Show this help message

Environment Variables (in .env):
  TELEGRAM_BOT_TOKEN   Telegram bot token for alerts
  TELEGRAM_CHAT_ID     Telegram chat ID to send alerts to

Examples:
  # Run with default settings
  npx ts-node src/smart-money/index.ts

  # Only alert on trades >= $10k
  npx ts-node src/smart-money/index.ts --min-trade=10000

  # Only alert on HIGH or CRITICAL severity
  npx ts-node src/smart-money/index.ts --min-severity=HIGH
`);
}

main().catch(console.error);

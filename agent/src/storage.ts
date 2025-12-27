import { createObjectCsvWriter } from 'csv-writer';
import { MarketRelation } from './types';
import * as fs from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'telliott22/trading-bot';
const GITHUB_CSV_PATH = 'dashboard/public/predictions.csv';
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${GITHUB_CSV_PATH}`;

const CSV_HEADER = [
    { id: 'timestamp', title: 'timestamp' },
    { id: 'market1Id', title: 'market1Id' },
    { id: 'market2Id', title: 'market2Id' },
    { id: 'market1Slug', title: 'market1Slug' },
    { id: 'market2Slug', title: 'market2Slug' },
    { id: 'market1Question', title: 'market1Question' },
    { id: 'market2Question', title: 'market2Question' },
    { id: 'market1YesPrice', title: 'market1YesPrice' },
    { id: 'market2YesPrice', title: 'market2YesPrice' },
    { id: 'relationshipType', title: 'relationshipType' },
    { id: 'confidenceScore', title: 'confidenceScore' },
    { id: 'tradingRationale', title: 'tradingRationale' },
    { id: 'expectedEdge', title: 'expectedEdge' },
    { id: 'leaderId', title: 'leaderId' },
    { id: 'followerId', title: 'followerId' },
    { id: 'leaderEndDate', title: 'leaderEndDate' },
    { id: 'timeGap', title: 'timeGap' },
    { id: 'timeGapDays', title: 'timeGapDays' }
];

export class Storage {
    private filePath: string;
    private allRecords: any[] = [];
    private initialized: boolean = false;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    /**
     * Initialize storage by fetching existing data from GitHub
     * This ensures we never lose historical data even on fresh deployments
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            console.log('Fetching existing predictions from GitHub...');
            const response = await fetch(GITHUB_RAW_URL);

            if (response.ok) {
                const csvText = await response.text();
                this.allRecords = this.parseCSV(csvText);
                console.log(`✓ Loaded ${this.allRecords.length} existing predictions from GitHub`);
            } else if (response.status === 404) {
                console.log('No existing predictions on GitHub, starting fresh');
                this.allRecords = [];
            } else {
                console.warn(`Failed to fetch from GitHub (${response.status}), starting fresh`);
                this.allRecords = [];
            }
        } catch (error) {
            console.error('Error fetching from GitHub:', error);
            this.allRecords = [];
        }

        this.initialized = true;
    }

    /**
     * Parse CSV text handling quoted fields with commas
     */
    private parseCSV(csvText: string): any[] {
        const lines = csvText.trim().split('\n');
        if (lines.length <= 1) return [];

        const headers = lines[0].split(',');
        const records: any[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length >= headers.length) {
                const record: any = {};
                headers.forEach((key, idx) => {
                    record[key] = values[idx] || '';
                });
                records.push(record);
            }
        }

        return records;
    }

    /**
     * Parse a single CSV line, handling quoted fields with commas
     */
    private parseCSVLine(line: string): string[] {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    // Toggle quote mode
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values;
    }

    public async savePredictions(predictions: MarketRelation[]) {
        if (predictions.length === 0) return;

        // Ensure initialized
        await this.initialize();

        const records = predictions.map(p => {
            // Find leader market to get end date
            const leader = p.leaderId === p.market1.id ? p.market1 : p.market2;

            return {
                timestamp: p.timestamp,
                market1Id: p.market1.id,
                market2Id: p.market2.id,
                market1Slug: p.market1.slug || p.market1.id,
                market2Slug: p.market2.slug || p.market2.id,
                market1Question: p.market1.question,
                market2Question: p.market2.question,
                market1YesPrice: p.market1.yesPrice?.toFixed(2) || '',
                market2YesPrice: p.market2.yesPrice?.toFixed(2) || '',
                relationshipType: p.relationshipType,
                confidenceScore: p.confidenceScore,
                tradingRationale: p.tradingRationale || p.rationale,
                expectedEdge: p.expectedEdge || '',
                leaderId: p.leaderId,
                followerId: p.followerId,
                leaderEndDate: leader.endTime || '',
                timeGap: p.timeGap,
                timeGapDays: p.timeGapDays?.toFixed(1) || ''
            };
        });

        // Add to in-memory records
        this.allRecords.push(...records);

        // Write ALL records (existing + new) to local file
        // This ensures we always have the complete dataset
        const csvWriter = createObjectCsvWriter({
            path: this.filePath,
            header: CSV_HEADER,
            append: false // Always overwrite with full dataset
        });

        await csvWriter.writeRecords(this.allRecords);
        console.log(`✓ Saved ${predictions.length} new signals (${this.allRecords.length} total) to CSV.`);
    }

    /**
     * Push the CSV to GitHub so the dashboard can access it
     */
    public async pushToGitHub(): Promise<void> {
        if (!GITHUB_TOKEN) {
            console.log('⚠ GITHUB_TOKEN not set, skipping GitHub push');
            return;
        }

        try {
            // Read current CSV content
            const csvContent = fs.readFileSync(this.filePath, 'utf-8');
            const contentBase64 = Buffer.from(csvContent).toString('base64');

            // Get current file SHA (needed for update)
            let sha: string | undefined;
            try {
                const getResponse = await fetch(
                    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_CSV_PATH}`,
                    {
                        headers: {
                            'Authorization': `token ${GITHUB_TOKEN}`,
                            'Accept': 'application/vnd.github.v3+json',
                        },
                    }
                );
                if (getResponse.ok) {
                    const data = await getResponse.json();
                    sha = data.sha;
                }
            } catch (e) {
                // File doesn't exist yet, that's fine
            }

            // Create or update file
            const response = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_CSV_PATH}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: `Update predictions.csv [automated]`,
                        content: contentBase64,
                        sha: sha,
                    }),
                }
            );

            if (response.ok) {
                console.log('✓ Pushed predictions.csv to GitHub');
            } else {
                const error = await response.text();
                console.error('Failed to push to GitHub:', error);
            }
        } catch (error) {
            console.error('Error pushing to GitHub:', error);
        }
    }
}

import { createObjectCsvWriter } from 'csv-writer';
import { MarketRelation } from './types';
import * as fs from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'telliott22/trading-bot';
const GITHUB_CSV_PATH = 'dashboard/public/predictions.csv';

export class Storage {
    private csvWriter: any;
    private filePath: string;
    private allRecords: any[] = [];

    constructor(filePath: string) {
        this.filePath = filePath;
        const fileExists = fs.existsSync(filePath);

        // Load existing records if file exists
        if (fileExists) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.trim().split('\n');
                if (lines.length > 1) {
                    // Skip header, parse existing records
                    const header = lines[0].split(',');
                    for (let i = 1; i < lines.length; i++) {
                        // Simple CSV parse (assumes no commas in values for now)
                        const values = lines[i].split(',');
                        const record: any = {};
                        header.forEach((key, idx) => {
                            record[key] = values[idx] || '';
                        });
                        this.allRecords.push(record);
                    }
                }
            } catch (e) {
                console.log('Could not load existing CSV, starting fresh');
            }
        }

        this.csvWriter = createObjectCsvWriter({
            path: this.filePath,
            header: [
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
                { id: 'timeGap', title: 'timeGap' },
                { id: 'timeGapDays', title: 'timeGapDays' }
            ],
            append: fileExists
        });
    }

    public async savePredictions(predictions: MarketRelation[]) {
        if (predictions.length === 0) return;

        const records = predictions.map(p => ({
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
            timeGap: p.timeGap,
            timeGapDays: p.timeGapDays?.toFixed(1) || ''
        }));

        // Add to in-memory records
        this.allRecords.push(...records);

        await this.csvWriter.writeRecords(records);
        console.log(`✓ Saved ${predictions.length} actionable signals to CSV.`);
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

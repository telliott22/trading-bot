import { createObjectCsvWriter } from 'csv-writer';
import { MarketRelation } from './types';
import * as fs from 'fs';

export class Storage {
    private csvWriter: any;
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
        const fileExists = fs.existsSync(filePath);

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

        await this.csvWriter.writeRecords(records);
        console.log(`✓ Saved ${predictions.length} actionable signals to CSV.`);
    }
}

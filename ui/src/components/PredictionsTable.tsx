import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';

interface Prediction {
    timestamp: string;
    market1Id: string;
    market2Id: string;
    market1Question: string;
    market2Question: string;
    relationshipType: string;
    confidenceScore: number;
    rationale: string;
}

const PredictionsTable: React.FC = () => {
    const [data, setData] = useState<Prediction[]>([]);

    useEffect(() => {
        const fetchData = () => {
            Papa.parse('/predictions.csv', {
                download: true,
                header: true,
                complete: (results) => {
                    const parsedData = results.data as Prediction[];
                    setData(parsedData.filter(row => row.market1Question));
                },
                error: (err) => {
                    console.error("Error fetching CSV:", err);
                }
            });
        };

        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-100">
                <svg className="w-12 h-12 mb-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="font-medium">Waiting for Agent Signals...</p>
            </div>
        );
    }

    const getActionType = (type: string, confidence: number) => {
        if (confidence < 0.6) return { text: 'WAIT', color: 'bg-gray-100 text-gray-600', icon: '✋' };
        if (type === 'SAME_OUTCOME') return { text: 'TRADE: CORRELATION', color: 'bg-green-100 text-green-700', icon: '⚡' };
        if (type === 'DIFFERENT_OUTCOME') return { text: 'TRADE: HEDGE', color: 'bg-purple-100 text-purple-700', icon: '⚖️' };
        return { text: 'OBSERVE', color: 'bg-blue-100 text-blue-700', icon: '👁️' };
    };

    return (
        <div className="grid gap-6">
            {data.slice().reverse().map((row, index) => {
                const confidence = Number(row.confidenceScore);
                const action = getActionType(row.relationshipType, confidence);

                return (
                    <div key={index} className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 overflow-hidden relative">
                        {/* Confidence Bar Top */}
                        <div className={`h-1.5 w-full ${confidence > 0.7 ? 'bg-gradient-to-r from-green-400 to-blue-500' : 'bg-gray-200'}`} />

                        <div className="p-6">
                            {/* Header */}
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Generated Signal</span>
                                    <span className="text-sm font-medium text-gray-600 font-mono">
                                        {new Date(row.timestamp).toLocaleTimeString()}
                                    </span>
                                </div>
                                <div className={`px-4 py-2 rounded-lg text-sm font-bold flex flex-col items-end gap-1 ${action.color}`}>
                                    <div className="flex items-center gap-2">
                                        <span>{action.icon}</span>
                                        {action.text}
                                    </div>
                                    <span className="text-[10px] opacity-80 font-normal normal-case">
                                        {row.relationshipType === 'SAME_OUTCOME' ? 'Markets move together. Consider buying both.' :
                                            row.relationshipType === 'DIFFERENT_OUTCOME' ? 'Markets move opposite. Bet on divergence.' : ''}
                                    </span>
                                </div>
                            </div>

                            {/* Markets Comparison */}
                            <div className="grid md:grid-cols-[1fr,auto,1fr] gap-6 items-center mb-8 relative">
                                {/* Connector Line (Mobile hidden) */}
                                <div className="hidden md:block absolute top-1/2 left-10 right-10 h-0.5 bg-gray-100 -z-0"></div>

                                {/* Market 1 */}
                                <div className="z-10 bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-blue-300 transition-colors">
                                    <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Market A</div>
                                    <h3 className="font-bold text-gray-900 leading-snug mb-3 min-h-[3rem] line-clamp-2">
                                        {row.market1Question}
                                    </h3>
                                    <a
                                        href={`https://polymarket.com/market/${row.market1Id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-md hover:bg-blue-100 transition-colors"
                                    >
                                        Buy Yes/No ↗
                                    </a>
                                </div>

                                {/* Relation Indicator */}
                                <div className="z-10 flex flex-col items-center justify-center bg-gray-50 rounded-full w-12 h-12 shadow-inner mx-auto">
                                    <span className="text-lg font-bold text-gray-400">vs</span>
                                </div>

                                {/* Market 2 */}
                                <div className="z-10 bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-purple-300 transition-colors">
                                    <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Market B</div>
                                    <h3 className="font-bold text-gray-900 leading-snug mb-3 min-h-[3rem] line-clamp-2">
                                        {row.market2Question}
                                    </h3>
                                    <a
                                        href={`https://polymarket.com/market/${row.market2Id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center text-sm font-semibold text-purple-600 hover:text-purple-700 bg-purple-50 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
                                    >
                                        Buy Yes/No ↗
                                    </a>
                                </div>
                            </div>

                            {/* Analysis Footer */}
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">AI Analysis</span>
                                    <span className="text-xs font-bold text-gray-900 bg-white px-2 py-1 rounded shadow-sm">
                                        {(confidence * 100).toFixed(0)}% Confidence
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600 leading-relaxed">
                                    {row.rationale}
                                </p>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default PredictionsTable;

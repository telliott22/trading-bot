import React, { useEffect, useState, useMemo } from 'react';
import Papa from 'papaparse';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    ExternalLink,
    TrendingUp,
    ArrowRightLeft,
    Clock,
    Zap,
    Activity,
    Timer,
    ChevronLeft,
    ChevronRight,
    BarChart3
} from 'lucide-react';

interface Prediction {
    timestamp: string;
    market1Id: string;
    market2Id: string;
    market1Question: string;
    market2Question: string;
    relationshipType: string;
    confidenceScore: number;
    rationale: string;
    leaderId?: string;
    followerId?: string;
    timeGap?: string;
}

const ITEMS_PER_PAGE = 15;

const Dashboard: React.FC = () => {
    const [data, setData] = useState<Prediction[]>([]);
    const [filter, setFilter] = useState<'SAME_OUTCOME' | 'DIFFERENT_OUTCOME' | 'ALL'>('SAME_OUTCOME');
    const [minConfidence, setMinConfidence] = useState<string>('0.7');
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedRow, setExpandedRow] = useState<number | null>(null);

    useEffect(() => {
        const fetchData = () => {
            Papa.parse('/predictions.csv', {
                download: true,
                header: true,
                skipEmptyLines: true,
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

    const filteredData = useMemo(() => {
        let result = data.slice().reverse();

        // Filter by relationship type
        if (filter !== 'ALL') {
            result = result.filter(row => row.relationshipType === filter);
        }

        // Filter by confidence
        const minConf = parseFloat(minConfidence);
        result = result.filter(row => Number(row.confidenceScore) >= minConf);

        return result;
    }, [data, filter, minConfidence]);

    // Pagination
    const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
    const paginatedData = filteredData.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    // Reset to page 1 when filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [filter, minConfidence]);

    // Stats
    const stats = useMemo(() => ({
        total: data.length,
        correlated: data.filter(d => d.relationshipType === 'SAME_OUTCOME').length,
        hedge: data.filter(d => d.relationshipType === 'DIFFERENT_OUTCOME').length,
        withLeader: data.filter(d => d.leaderId && d.timeGap && d.timeGap !== '0d 0h').length
    }), [data]);

    const getConfidenceColor = (score: number) => {
        if (score >= 0.85) return 'bg-emerald-500';
        if (score >= 0.7) return 'bg-amber-500';
        return 'bg-slate-500';
    };

    const formatTimeAgo = (timestamp: string) => {
        const diff = Date.now() - new Date(timestamp).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    if (data.length === 0) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto mb-4"></div>
                    <p className="text-slate-400">Loading signals...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* Header */}
            <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center">
                                <Activity className="h-5 w-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-lg font-semibold">Signal Dashboard</h1>
                                <p className="text-xs text-slate-500">{stats.total} signals processed</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
                            Live
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-6">
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                    <Card className="bg-slate-900 border-slate-800">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Total Signals</p>
                                    <p className="text-2xl font-bold">{stats.total}</p>
                                </div>
                                <BarChart3 className="h-8 w-8 text-slate-700" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-slate-900 border-slate-800">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Correlated</p>
                                    <p className="text-2xl font-bold text-emerald-500">{stats.correlated}</p>
                                </div>
                                <TrendingUp className="h-8 w-8 text-emerald-900" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-slate-900 border-slate-800">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Hedge</p>
                                    <p className="text-2xl font-bold text-orange-500">{stats.hedge}</p>
                                </div>
                                <ArrowRightLeft className="h-8 w-8 text-orange-900" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-slate-900 border-slate-800">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">With Leader</p>
                                    <p className="text-2xl font-bold text-blue-500">{stats.withLeader}</p>
                                </div>
                                <Timer className="h-8 w-8 text-blue-900" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <div className="flex items-center justify-between mb-4">
                    <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                        <TabsList className="bg-slate-900 border border-slate-800">
                            <TabsTrigger
                                value="SAME_OUTCOME"
                                className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
                            >
                                <TrendingUp className="h-4 w-4 mr-2" />
                                Correlated
                                <Badge variant="secondary" className="ml-2 bg-slate-800 text-slate-400">
                                    {stats.correlated}
                                </Badge>
                            </TabsTrigger>
                            <TabsTrigger
                                value="DIFFERENT_OUTCOME"
                                className="data-[state=active]:bg-orange-600 data-[state=active]:text-white"
                            >
                                <ArrowRightLeft className="h-4 w-4 mr-2" />
                                Hedge
                                <Badge variant="secondary" className="ml-2 bg-slate-800 text-slate-400">
                                    {stats.hedge}
                                </Badge>
                            </TabsTrigger>
                            <TabsTrigger
                                value="ALL"
                                className="data-[state=active]:bg-slate-700"
                            >
                                All
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-500">Min Confidence:</span>
                        <Select value={minConfidence} onValueChange={setMinConfidence}>
                            <SelectTrigger className="w-24 bg-slate-900 border-slate-800">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800">
                                <SelectItem value="0.5">50%</SelectItem>
                                <SelectItem value="0.6">60%</SelectItem>
                                <SelectItem value="0.7">70%</SelectItem>
                                <SelectItem value="0.8">80%</SelectItem>
                                <SelectItem value="0.9">90%</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Table */}
                <Card className="bg-slate-900 border-slate-800 overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-slate-800 hover:bg-slate-900">
                                <TableHead className="text-slate-400 w-20">Time</TableHead>
                                <TableHead className="text-slate-400">Market Pair</TableHead>
                                <TableHead className="text-slate-400 w-28">Confidence</TableHead>
                                <TableHead className="text-slate-400 w-32">Strategy</TableHead>
                                <TableHead className="text-slate-400 w-20 text-right">Links</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedData.map((row, index) => {
                                const confidence = Number(row.confidenceScore);
                                const hasLeader = row.leaderId && row.timeGap && row.timeGap !== '0d 0h';
                                const isExpanded = expandedRow === index;
                                const globalIndex = (currentPage - 1) * ITEMS_PER_PAGE + index;

                                return (
                                    <React.Fragment key={globalIndex}>
                                        <TableRow
                                            className={`border-slate-800 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-800/50' : 'hover:bg-slate-800/30'}`}
                                            onClick={() => setExpandedRow(isExpanded ? null : index)}
                                        >
                                            <TableCell className="text-slate-500 font-mono text-xs">
                                                {formatTimeAgo(row.timestamp)}
                                            </TableCell>
                                            <TableCell>
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        {hasLeader && row.leaderId === row.market1Id && (
                                                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5">
                                                                LEAD
                                                            </Badge>
                                                        )}
                                                        <span className="text-sm font-medium line-clamp-1">
                                                            {row.market1Question}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-slate-500">
                                                        {hasLeader && row.leaderId === row.market2Id && (
                                                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5">
                                                                LEAD
                                                            </Badge>
                                                        )}
                                                        <span className="text-sm line-clamp-1">
                                                            {row.market2Question}
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full ${getConfidenceColor(confidence)} rounded-full transition-all`}
                                                            style={{ width: `${confidence * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-sm font-medium w-10">
                                                        {(confidence * 100).toFixed(0)}%
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {hasLeader ? (
                                                    <div className="flex items-center gap-1.5 text-blue-400">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        <span className="text-sm">Wait {row.timeGap}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-slate-600">Immediate</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex gap-1 justify-end">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 w-7 p-0 text-slate-500 hover:text-white hover:bg-slate-800"
                                                        onClick={(e) => { e.stopPropagation(); }}
                                                        asChild
                                                    >
                                                        <a href={`https://polymarket.com/event/${row.market1Id}`} target="_blank" rel="noopener noreferrer">
                                                            <ExternalLink className="w-3.5 h-3.5" />
                                                        </a>
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 w-7 p-0 text-slate-500 hover:text-white hover:bg-slate-800"
                                                        onClick={(e) => { e.stopPropagation(); }}
                                                        asChild
                                                    >
                                                        <a href={`https://polymarket.com/event/${row.market2Id}`} target="_blank" rel="noopener noreferrer">
                                                            <ExternalLink className="w-3.5 h-3.5" />
                                                        </a>
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                        {isExpanded && (
                                            <TableRow className="bg-slate-800/30 border-slate-800">
                                                <TableCell colSpan={5} className="py-4">
                                                    <div className="text-sm text-slate-400 leading-relaxed max-w-4xl">
                                                        <span className="text-slate-500 font-medium">AI Analysis: </span>
                                                        {row.rationale}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </TableBody>
                    </Table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
                            <p className="text-sm text-slate-500">
                                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredData.length)} of {filteredData.length}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0 border-slate-700 bg-slate-800 hover:bg-slate-700"
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm text-slate-400 min-w-[80px] text-center">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0 border-slate-700 bg-slate-800 hover:bg-slate-700"
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default Dashboard;

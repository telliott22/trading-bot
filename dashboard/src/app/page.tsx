"use client";

import { useEffect, useState, useMemo } from "react";
import Papa from "papaparse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  ArrowRightLeft,
  Clock,
  Activity,
  Timer,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  BarChart3,
  Zap,
  Crown,
  Target,
} from "lucide-react";

interface Prediction {
  timestamp: string;
  market1Id: string;
  market2Id: string;
  market1Slug?: string;
  market2Slug?: string;
  market1Question: string;
  market2Question: string;
  market1YesPrice?: string;
  market2YesPrice?: string;
  relationshipType: string;
  confidenceScore: number;
  tradingRationale?: string;
  expectedEdge?: string;
  leaderId?: string;
  followerId?: string;
  timeGap?: string;
  timeGapDays?: string;
}

const ITEMS_PER_PAGE = 10;

export default function Dashboard() {
  const [data, setData] = useState<Prediction[]>([]);
  const [filter, setFilter] = useState<
    "SAME_OUTCOME" | "DIFFERENT_OUTCOME" | "ALL"
  >("SAME_OUTCOME");
  const [minConfidence, setMinConfidence] = useState<string>("0.7");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  useEffect(() => {
    const CSV_URL = "https://raw.githubusercontent.com/telliott22/trading-bot/main/dashboard/public/predictions.csv";

    const fetchData = () => {
      Papa.parse(CSV_URL, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedData = results.data as Prediction[];
          setData(parsedData.filter((row) => row.market1Question));
        },
        error: (err) => {
          console.error("Error fetching CSV:", err);
        },
      });
    };

    fetchData();
    const interval = setInterval(fetchData, 60000); // Check every minute (GitHub caches for ~5 min)
    return () => clearInterval(interval);
  }, []);

  const filteredData = useMemo(() => {
    let result = data.slice().reverse();

    // Filter out UNRELATED by default (unless viewing ALL)
    if (filter !== "ALL") {
      result = result.filter((row) => row.relationshipType === filter);
    } else {
      // Even in ALL view, exclude UNRELATED (noise)
      result = result.filter((row) => row.relationshipType !== "UNRELATED");
    }

    const minConf = parseFloat(minConfidence);
    result = result.filter((row) => Number(row.confidenceScore) >= minConf);

    // Sort by time gap (best opportunities first - largest gaps)
    result.sort((a, b) => {
      const gapA = parseFloat(a.timeGapDays || '0');
      const gapB = parseFloat(b.timeGapDays || '0');
      return gapB - gapA;
    });

    return result;
  }, [data, filter, minConfidence]);

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, minConfidence]);

  const stats = useMemo(
    () => ({
      total: data.length,
      correlated: data.filter((d) => d.relationshipType === "SAME_OUTCOME")
        .length,
      hedge: data.filter((d) => d.relationshipType === "DIFFERENT_OUTCOME")
        .length,
      withLeader: data.filter(
        (d) => d.leaderId && d.timeGap && d.timeGap !== "0d 0h"
      ).length,
    }),
    [data]
  );

  const getConfidenceColor = (score: number) => {
    if (score >= 0.85) return "bg-emerald-500";
    if (score >= 0.7) return "bg-amber-500";
    return "bg-zinc-500";
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  // Build proper Polymarket URL
  const getMarketUrl = (slug?: string, id?: string) => {
    if (slug) {
      return `https://polymarket.com/event/${slug}`;
    }
    // Fallback: try using ID (may not work)
    return `https://polymarket.com/event/${id}`;
  };

  if (data.length === 0) {
    return (
      <div className="dark min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading signals...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Activity className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Polymarket Signals
                </h1>
                <p className="text-sm text-zinc-500">
                  AI-powered market correlations
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-sm text-emerald-400 font-medium">
                  Live
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-500 mb-1">
                    Total Signals
                  </p>
                  <p className="text-3xl font-bold tracking-tight">
                    {stats.total}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-zinc-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 hover:border-emerald-500/50 transition-colors group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-500 mb-1">
                    Correlated
                  </p>
                  <p className="text-3xl font-bold tracking-tight text-emerald-400">
                    {stats.correlated}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-emerald-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 hover:border-orange-500/50 transition-colors group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-500 mb-1">
                    Hedge
                  </p>
                  <p className="text-3xl font-bold tracking-tight text-orange-400">
                    {stats.hedge}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <ArrowRightLeft className="h-6 w-6 text-orange-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 hover:border-blue-500/50 transition-colors group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-500 mb-1">
                    Leader-Follower
                  </p>
                  <p className="text-3xl font-bold tracking-tight text-blue-400">
                    {stats.withLeader}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Timer className="h-6 w-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center justify-between mb-6">
          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
          >
            <TabsList className="bg-zinc-900 border border-zinc-800 p-1">
              <TabsTrigger
                value="SAME_OUTCOME"
                className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Correlated
                <Badge
                  variant="secondary"
                  className="ml-2 bg-zinc-800 text-zinc-400 text-xs"
                >
                  {stats.correlated}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="DIFFERENT_OUTCOME"
                className="data-[state=active]:bg-orange-600 data-[state=active]:text-white px-4"
              >
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Hedge
                <Badge
                  variant="secondary"
                  className="ml-2 bg-zinc-800 text-zinc-400 text-xs"
                >
                  {stats.hedge}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="ALL"
                className="data-[state=active]:bg-zinc-700 px-4"
              >
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">Min Confidence:</span>
            <Select value={minConfidence} onValueChange={setMinConfidence}>
              <SelectTrigger className="w-24 bg-zinc-900 border-zinc-800">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="0.5">50%</SelectItem>
                <SelectItem value="0.6">60%</SelectItem>
                <SelectItem value="0.7">70%</SelectItem>
                <SelectItem value="0.8">80%</SelectItem>
                <SelectItem value="0.9">90%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Signals Table */}
        <Card className="bg-zinc-900/50 border-zinc-800 overflow-hidden">
          <CardHeader className="border-b border-zinc-800 bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-lg font-semibold">
                {filter === "SAME_OUTCOME"
                  ? "Correlated Pairs"
                  : filter === "DIFFERENT_OUTCOME"
                    ? "Hedge Pairs"
                    : "All Signals"}
              </CardTitle>
              <Badge variant="secondary" className="ml-2">
                {filteredData.length} results
              </Badge>
            </div>
          </CardHeader>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-500 font-medium w-16">
                    Time
                  </TableHead>
                  <TableHead className="text-zinc-500 font-medium min-w-[300px]">
                    Market Pair
                  </TableHead>
                  <TableHead className="text-zinc-500 font-medium w-24">
                    Confidence
                  </TableHead>
                  <TableHead className="text-zinc-500 font-medium w-28">
                    Strategy
                  </TableHead>
                  <TableHead className="text-zinc-500 font-medium w-48">
                    Trade Links
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-12 text-zinc-500"
                    >
                      No signals match your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedData.map((row, index) => {
                    const confidence = Number(row.confidenceScore);
                    const hasLeader =
                      row.leaderId && row.timeGap && row.timeGap !== "0d 0h";
                    const isExpanded = expandedRow === index;

                    // Determine which market is leader/follower
                    const market1IsLeader = row.leaderId === row.market1Id;
                    const market2IsLeader = row.leaderId === row.market2Id;

                    return (
                      <>
                        <TableRow
                          key={index}
                          className={`border-zinc-800 cursor-pointer transition-all ${isExpanded
                            ? "bg-zinc-800/50"
                            : "hover:bg-zinc-800/30"
                            }`}
                          onClick={() =>
                            setExpandedRow(isExpanded ? null : index)
                          }
                        >
                          <TableCell className="text-zinc-500 font-mono text-xs">
                            {formatTimeAgo(row.timestamp)}
                          </TableCell>
                          <TableCell className="max-w-[400px]">
                            <div className="space-y-2">
                              {/* Market 1 */}
                              <div className="flex items-start gap-2">
                                {hasLeader && (
                                  <Badge
                                    className={`shrink-0 text-[10px] px-1.5 ${market1IsLeader
                                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                      : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                      }`}
                                  >
                                    {market1IsLeader ? (
                                      <><Crown className="w-3 h-3 mr-0.5" />LEADER</>
                                    ) : (
                                      <><Target className="w-3 h-3 mr-0.5" />FOLLOW</>
                                    )}
                                  </Badge>
                                )}
                                <span className="text-sm font-medium text-zinc-100 line-clamp-1">
                                  {row.market1Question}
                                </span>
                              </div>
                              {/* Market 2 */}
                              <div className="flex items-start gap-2">
                                {hasLeader && (
                                  <Badge
                                    className={`shrink-0 text-[10px] px-1.5 ${market2IsLeader
                                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                      : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                      }`}
                                  >
                                    {market2IsLeader ? (
                                      <><Crown className="w-3 h-3 mr-0.5" />LEADER</>
                                    ) : (
                                      <><Target className="w-3 h-3 mr-0.5" />FOLLOW</>
                                    )}
                                  </Badge>
                                )}
                                <span className="text-sm text-zinc-400 line-clamp-1">
                                  {row.market2Question}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${getConfidenceColor(confidence)} rounded-full`}
                                  style={{ width: `${confidence * 100}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-zinc-200 tabular-nums">
                                {(confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {hasLeader ? (
                              <div className="flex items-center gap-1.5 text-blue-400">
                                <Clock className="w-4 h-4 shrink-0" />
                                <span className="text-sm font-medium whitespace-nowrap">
                                  Wait {row.timeGap}
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm text-zinc-600">
                                Direct
                              </span>
                            )}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant={hasLeader && market1IsLeader ? "outline" : "default"}
                                className={`h-7 text-xs ${hasLeader && market1IsLeader
                                  ? "border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                                  : hasLeader
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "bg-zinc-700 hover:bg-zinc-600"
                                  }`}
                                asChild
                              >
                                <a
                                  href={getMarketUrl(row.market1Slug, row.market1Id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {hasLeader && market1IsLeader ? (
                                    <>Watch</>
                                  ) : hasLeader ? (
                                    <>Trade</>
                                  ) : (
                                    <>Market A</>
                                  )}
                                  <ExternalLink className="w-3 h-3 ml-1" />
                                </a>
                              </Button>
                              <Button
                                size="sm"
                                variant={hasLeader && market2IsLeader ? "outline" : "default"}
                                className={`h-7 text-xs ${hasLeader && market2IsLeader
                                  ? "border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                                  : hasLeader
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "bg-zinc-700 hover:bg-zinc-600"
                                  }`}
                                asChild
                              >
                                <a
                                  href={getMarketUrl(row.market2Slug, row.market2Id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {hasLeader && market2IsLeader ? (
                                    <>Watch</>
                                  ) : hasLeader ? (
                                    <>Trade</>
                                  ) : (
                                    <>Market B</>
                                  )}
                                  <ExternalLink className="w-3 h-3 ml-1" />
                                </a>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-zinc-800/30 border-zinc-800">
                            <TableCell colSpan={5} className="py-4 px-6">
                              <div className="max-w-3xl space-y-3">
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-1">
                                    Trading Strategy
                                  </p>
                                  <p className="text-sm text-zinc-300 leading-relaxed break-words">
                                    {row.tradingRationale || "No trading rationale available"}
                                  </p>
                                </div>
                                {row.expectedEdge && (
                                  <div>
                                    <p className="text-xs uppercase tracking-wide text-emerald-500 font-semibold mb-1">
                                      Expected Edge
                                    </p>
                                    <p className="text-sm text-zinc-300 leading-relaxed break-words">
                                      {row.expectedEdge}
                                    </p>
                                  </div>
                                )}
                                {(row.market1YesPrice || row.market2YesPrice) && (
                                  <div className="flex gap-6 pt-2 border-t border-zinc-700">
                                    <div>
                                      <span className="text-xs text-zinc-500">Market 1 YES:</span>
                                      <span className="ml-2 text-sm font-mono text-zinc-300">
                                        {row.market1YesPrice ? `${(parseFloat(row.market1YesPrice) * 100).toFixed(0)}%` : 'N/A'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-xs text-zinc-500">Market 2 YES:</span>
                                      <span className="ml-2 text-sm font-mono text-zinc-300">
                                        {row.market2YesPrice ? `${(parseFloat(row.market2YesPrice) * 100).toFixed(0)}%` : 'N/A'}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
              <p className="text-sm text-zinc-500">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 border-zinc-700 bg-zinc-800/50"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 border-zinc-700 bg-zinc-800/50"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

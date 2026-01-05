"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Clock,
  ExternalLink,
  Wifi,
  WifiOff,
} from "lucide-react";

interface Alert {
  id: string;
  type: string;
  marketId: string;
  marketQuestion: string;
  severity: string;
  timestamp: number;
  currentPrice: number;
  impliedDirection: string;
  details: {
    tradeSize?: number;
    percentile?: number;
    rank?: number;
    totalTrades?: number;
    medianSize?: number;
    volumeMultiple?: number;
    priceChange?: number;
  };
}

interface AlertsData {
  lastUpdated: string;
  totalAlerts: number;
  alerts: Alert[];
  stats: {
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    last24h: number;
    last7d: number;
  };
}

export function SmartMoneyAlerts() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const ALERTS_URL =
      "https://raw.githubusercontent.com/telliott22/trading-bot/main/dashboard/public/smart-money-alerts.json";

    const fetchData = async () => {
      try {
        const response = await fetch(ALERTS_URL);
        if (!response.ok) {
          // File might not exist yet
          if (response.status === 404) {
            setData({
              lastUpdated: new Date().toISOString(),
              totalAlerts: 0,
              alerts: [],
              stats: { byType: {}, bySeverity: {}, last24h: 0, last7d: 0 },
            });
            setLoading(false);
            return;
          }
          throw new Error("Failed to fetch alerts");
        }
        const json = await response.json();
        setData(json);
        setIsLive(true);
        setError(null);
      } catch (err) {
        console.error("Error fetching alerts:", err);
        setError("Could not load smart money alerts");
        setIsLive(false);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "HIGH":
        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "MEDIUM":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "UNUSUAL_LOW_PRICE_BUY":
        return "Insider Signal";
      case "LARGE_TRADE":
        return "Whale Trade";
      case "VOLUME_SPIKE":
        return "Volume Spike";
      case "RAPID_PRICE_MOVE":
        return "Price Move";
      default:
        return type;
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatDetails = (alert: Alert) => {
    const d = alert.details;
    if (alert.type === "UNUSUAL_LOW_PRICE_BUY" && d.percentile) {
      return `$${d.tradeSize?.toLocaleString()} (#${d.rank} of ${d.totalTrades}, ${(d.percentile * 100).toFixed(0)}th pctl)`;
    }
    if (alert.type === "LARGE_TRADE" && d.tradeSize) {
      return `$${d.tradeSize.toLocaleString()}`;
    }
    if (alert.type === "VOLUME_SPIKE" && d.volumeMultiple) {
      return `${d.volumeMultiple.toFixed(1)}x normal`;
    }
    if (alert.type === "RAPID_PRICE_MOVE" && d.priceChange) {
      return `${(d.priceChange * 100).toFixed(1)}%`;
    }
    return "";
  };

  if (loading) {
    return (
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading smart money alerts...</p>
        </CardContent>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-4" />
          <p className="text-zinc-400">{error}</p>
          <p className="text-zinc-500 text-sm mt-2">
            Smart money detector may not be running yet
          </p>
        </CardContent>
      </Card>
    );
  }

  const alerts = data?.alerts || [];
  const stats = data?.stats || { byType: {}, bySeverity: {}, last24h: 0, last7d: 0 };

  return (
    <div className="space-y-6">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
            <AlertTriangle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Smart Money Detector
            </h2>
            <p className="text-sm text-zinc-500">
              Real-time insider trading signals
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.lastUpdated && (
            <span className="text-xs text-zinc-500">
              Updated {formatTimeAgo(new Date(data.lastUpdated).getTime())}
            </span>
          )}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
              isLive
                ? "bg-red-500/10 border border-red-500/20"
                : "bg-zinc-500/10 border border-zinc-500/20"
            }`}
          >
            {isLive ? (
              <>
                <Wifi className="h-4 w-4 text-red-400" />
                <span className="text-sm text-red-400 font-medium">
                  Monitoring
                </span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-zinc-400" />
                <span className="text-sm text-zinc-400 font-medium">
                  Offline
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-500 mb-1">
                  Last 24h
                </p>
                <p className="text-3xl font-bold tracking-tight text-red-400">
                  {stats.last24h}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-500 mb-1">
                  Last 7 Days
                </p>
                <p className="text-3xl font-bold tracking-tight">
                  {stats.last7d}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                <Activity className="h-6 w-6 text-zinc-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-500 mb-1">
                  Insider Signals
                </p>
                <p className="text-3xl font-bold tracking-tight text-orange-400">
                  {stats.byType["UNUSUAL_LOW_PRICE_BUY"] || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-500 mb-1">
                  Critical
                </p>
                <p className="text-3xl font-bold tracking-tight text-red-400">
                  {stats.bySeverity["CRITICAL"] || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Table */}
      <Card className="bg-zinc-900/50 border-zinc-800 overflow-hidden">
        <CardHeader className="border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg font-semibold">
              Recent Alerts
            </CardTitle>
            <Badge variant="secondary" className="ml-2">
              {alerts.length} alerts
            </Badge>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500 font-medium w-24">
                  Time
                </TableHead>
                <TableHead className="text-zinc-500 font-medium w-32">
                  Type
                </TableHead>
                <TableHead className="text-zinc-500 font-medium w-24">
                  Severity
                </TableHead>
                <TableHead className="text-zinc-500 font-medium">
                  Market
                </TableHead>
                <TableHead className="text-zinc-500 font-medium w-40">
                  Details
                </TableHead>
                <TableHead className="text-zinc-500 font-medium w-24">
                  Direction
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-zinc-500"
                  >
                    No alerts yet. The detector is monitoring for suspicious
                    activity.
                  </TableCell>
                </TableRow>
              ) : (
                alerts.slice(0, 20).map((alert) => (
                  <TableRow
                    key={alert.id}
                    className="border-zinc-800 hover:bg-zinc-800/30"
                  >
                    <TableCell className="text-zinc-400 text-sm">
                      {formatTimeAgo(alert.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-zinc-800 text-zinc-300 border-zinc-700">
                        {getTypeLabel(alert.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getSeverityColor(alert.severity)}>
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <span className="text-sm text-zinc-200 line-clamp-1">
                        {alert.marketQuestion}
                      </span>
                      <span className="text-xs text-zinc-500 block">
                        @ {(alert.currentPrice * 100).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-300 font-mono">
                      {formatDetails(alert)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          alert.impliedDirection === "YES"
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                            : alert.impliedDirection === "NO"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                        }
                      >
                        {alert.impliedDirection}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

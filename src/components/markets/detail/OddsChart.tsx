import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChartDataPoint } from "@/hooks/useMarketDetail";
import { format } from "date-fns";
import { TrendingUp, BarChart3 } from "lucide-react";

interface OddsChartProps {
  data: ChartDataPoint[];
  resolvedAt?: string;
}

type TimeRange = "1H" | "6H" | "1D" | "7D" | "ALL";

export function OddsChart({ data, resolvedAt }: OddsChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  
  const hasData = data.length > 0;

  const resolvedTimestamp = resolvedAt
    ? new Date(resolvedAt).getTime()
    : undefined;

  // Filter data based on time range
  const filterDataByTimeRange = (data: ChartDataPoint[], range: TimeRange): ChartDataPoint[] => {
    if (range === "ALL" || data.length === 0) return data;
    
    const now = Date.now();
    const ranges: Record<TimeRange, number> = {
      "1H": 60 * 60 * 1000,
      "6H": 6 * 60 * 60 * 1000,
      "1D": 24 * 60 * 60 * 1000,
      "7D": 7 * 24 * 60 * 60 * 1000,
      "ALL": Infinity,
    };
    
    const cutoff = now - ranges[range];
    return data.filter(d => d.timestamp >= cutoff);
  };

  const filteredData = filterDataByTimeRange(data, timeRange);

  // Format data for display
  const chartData = filteredData.map((d) => ({
    ...d,
    label: format(new Date(d.time), timeRange === "1H" || timeRange === "6H" ? "HH:mm" : "MMM d, HH:mm"),
  }));

  const timeRanges: TimeRange[] = ["1H", "6H", "1D", "7D", "ALL"];

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-2 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2 font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" />
            YES Share of Pool
          </CardTitle>
          <div className="flex gap-1">
            {timeRanges.map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs font-medium"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {!hasData ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-muted-foreground text-sm bg-muted/20 rounded-xl border border-border/30">
            <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
            <p>No betting activity yet</p>
            <p className="text-xs mt-1 text-muted-foreground/70">Chart will appear after first bet</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-muted-foreground text-sm bg-muted/20 rounded-xl border border-border/30">
            <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
            <p>No data in selected time range</p>
          </div>
        ) : (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="yesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid 
                  strokeDasharray="3 3" 
                  stroke="hsl(var(--border))" 
                  strokeOpacity={0.5}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                    padding: "10px 14px",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
                  }}
                  formatter={(value: number) => [`${value}%`, "YES Share"]}
                  labelFormatter={(label) => label}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                />
                <Area
                  type="monotone"
                  dataKey="yes_percent"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  fill="url(#yesGradient)"
                  dot={false}
                  activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                />
                {resolvedTimestamp && (
                  <ReferenceLine
                    x={chartData.find((d) => d.timestamp >= resolvedTimestamp)?.label}
                    stroke="hsl(var(--destructive))"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    label={{
                      value: "Resolved",
                      position: "top",
                      fill: "hsl(var(--destructive))",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

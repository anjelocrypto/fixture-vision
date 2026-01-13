import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChartDataPoint } from "@/hooks/useMarketDetail";
import { format } from "date-fns";
import { TrendingUp, BarChart3 } from "lucide-react";

interface OddsChartProps {
  data: ChartDataPoint[];
  resolvedAt?: string;
}

export function OddsChart({ data, resolvedAt }: OddsChartProps) {
  const hasData = data.length > 0;

  const resolvedTimestamp = resolvedAt
    ? new Date(resolvedAt).getTime()
    : undefined;

  // Format data for display
  const chartData = data.map((d) => ({
    ...d,
    label: format(new Date(d.time), "MMM d, HH:mm"),
  }));

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="text-base flex items-center gap-2 font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          YES % Over Time
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {!hasData ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-muted-foreground text-sm bg-muted/20 rounded-xl border border-border/30">
            <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
            <p>No betting activity yet</p>
          </div>
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="yesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
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
                  formatter={(value: number) => [`${value}%`, "YES %"]}
                  labelFormatter={(label) => label}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                />
                <Line
                  type="monotone"
                  dataKey="yes_percent"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
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
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

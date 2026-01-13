import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { ChartDataPoint } from "@/hooks/useMarketDetail";
import { format } from "date-fns";
import { TrendingUp } from "lucide-react";

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          YES % Over Time
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            No betting activity yet
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`${value}%`, "YES %"]}
                  labelFormatter={(label) => label}
                />
                <Line
                  type="monotone"
                  dataKey="yes_percent"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {resolvedTimestamp && (
                  <ReferenceLine
                    x={chartData.find((d) => d.timestamp >= resolvedTimestamp)?.label}
                    stroke="hsl(var(--destructive))"
                    strokeDasharray="5 5"
                    label={{
                      value: "Resolved",
                      position: "top",
                      fill: "hsl(var(--destructive))",
                      fontSize: 10,
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

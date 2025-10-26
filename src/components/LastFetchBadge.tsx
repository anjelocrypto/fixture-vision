import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Calendar, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const LastFetchBadge = () => {
  const { data: lastRun } = useQuery({
    queryKey: ["last-fetch-run"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("optimizer_run_logs")
        .select("*")
        .eq("run_type", "fetch-fixtures")
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      return data;
    },
    refetchInterval: 30000, // Refresh every 30s
    staleTime: 10000,
  });

  if (!lastRun) return null;

  const inserted = lastRun.upserted || 0;
  const scope = lastRun.scope as any;
  const leaguesUpserted = scope?.leagues_upserted || 0;
  const timeAgo = formatDistanceToNow(new Date(lastRun.finished_at || lastRun.started_at), {
    addSuffix: true,
  });

  return (
    <div className="hidden sm:flex items-center gap-2">
      <Badge variant="outline" className="gap-1.5 text-xs">
        <Calendar className="h-3 w-3" />
        {timeAgo}
      </Badge>
      <Badge variant="secondary" className="gap-1.5 text-xs">
        <TrendingUp className="h-3 w-3" />
        {inserted} fixtures • {leaguesUpserted} leagues
      </Badge>
    </div>
  );
};

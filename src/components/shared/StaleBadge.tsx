import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface StaleBadgeProps {
  capturedAt: string | null | undefined;
  maxAgeHours?: number;
  label?: string;
}

/**
 * Shows a warning badge when data is older than maxAgeHours.
 * Used alongside LastFetchBadge for freshness visibility.
 */
export function StaleBadge({ capturedAt, maxAgeHours = 6, label = "Data" }: StaleBadgeProps) {
  if (!capturedAt) return null;

  const capturedDate = new Date(capturedAt);
  const ageMs = Date.now() - capturedDate.getTime();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  if (ageMs <= maxAgeMs) return null;

  const timeAgo = formatDistanceToNow(capturedDate, { addSuffix: true });

  return (
    <Badge variant="destructive" className="gap-1 text-xs">
      <AlertTriangle className="h-3 w-3" />
      {label} stale ({timeAgo})
    </Badge>
  );
}

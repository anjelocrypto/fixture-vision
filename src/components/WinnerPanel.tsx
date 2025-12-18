import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Lock } from "lucide-react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";

interface WinnerPanelProps {
  onClose: () => void;
}

export function WinnerPanel({ onClose }: WinnerPanelProps) {
  const { t } = useTranslation(['winner']);

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            {t('winner:title')}
            <InfoTooltip tooltipKey="winner" />
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Locked State */}
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
          <div className="p-4 rounded-full bg-muted">
            <Lock className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Coming Soon</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            We're currently improving this feature to provide more accurate winner predictions with better algorithms. It will be available in a future update.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

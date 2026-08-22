import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { settlementHoldCopy } from "@/lib/settlementSafety";

interface SettlementHoldBadgeProps {
  reason: string | null | undefined;
  className?: string;
}

/**
 * Presented for legs whose settlement is held by the backend safety rules.
 * The leg itself stays pending; we only explain that the fixture changed.
 * No internal alert, fingerprint or provider detail is ever rendered.
 */
export function SettlementHoldBadge({ reason, className }: SettlementHoldBadgeProps) {
  const { t } = useTranslation("common");
  if (!reason) return null;

  const copy = settlementHoldCopy(reason);

  return (
    <Badge variant="outline" className={className}>
      <AlertCircle className="mr-1 h-3 w-3" aria-hidden="true" />
      <span>
        {t(copy.titleKey, copy.fallbackTitle)} · {t(copy.reasonKey, copy.fallbackReason)}
      </span>
    </Badge>
  );
}

export default SettlementHoldBadge;

import { ReactNode } from "react";
import { useAccess } from "@/hooks/useAccess";

interface PaywallGateProps {
  children: ReactNode;
  feature?: string;
  featureKey?: string;
  allowTrial?: boolean;
  /** If true, renders nothing instead of paywall UI when blocked */
  silent?: boolean;
}

/**
 * PaywallGate - Conditionally renders children based on subscription status.
 * 
 * When user lacks access:
 * - If silent=true: renders nothing (for use with unified upgrade hero)
 * - If silent=false (default): renders null (parent handles upgrade UI)
 * 
 * Note: The actual upgrade UI should be rendered at a higher level to avoid
 * duplicate paywall cards across the page.
 */
export const PaywallGate = ({ 
  children, 
  feature = "this feature",
  silent = false 
}: PaywallGateProps) => {
  const { hasAccess, loading, isWhitelisted } = useAccess();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent mb-4" />
          <p className="text-muted-foreground">Checking access...</p>
        </div>
      </div>
    );
  }

  const hasPaidAccess = hasAccess || isWhitelisted;

  if (!hasPaidAccess) {
    // Return null - parent component should handle showing upgrade UI
    return null;
  }

  return <>{children}</>;
};

import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAccess } from "@/hooks/useAccess";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Sparkles } from "lucide-react";

interface PaywallGateProps {
  children: ReactNode;
  feature?: string;
  allowTrial?: boolean; // Whether this feature supports trial usage
}

export const PaywallGate = ({ children, feature = "this feature", allowTrial = false }: PaywallGateProps) => {
  const { hasAccess, loading, isWhitelisted, trialCredits } = useAccess();
  const navigate = useNavigate();

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

  // Check if user has access via subscription or whitelist
  const hasPaidAccess = hasAccess || isWhitelisted;
  
  // For features with trial: allow if has paid access OR has trial credits
  const hasPermission = allowTrial ? (hasPaidAccess || (trialCredits !== null && trialCredits > 0)) : hasPaidAccess;

  if (!hasPermission) {
    const showTrialMessage = allowTrial && trialCredits === 0;
    
    return (
      <div className="p-6">
        <Card className="border-primary/20">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-xl">
              {showTrialMessage ? "Trial Expired" : "Premium Feature"}
            </CardTitle>
            <CardDescription className="text-base">
              {showTrialMessage 
                ? `You've used all 5 free uses of ${feature}. Subscribe to continue.`
                : `Unlock ${feature} with a subscription`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {allowTrial && !showTrialMessage && trialCredits !== null && trialCredits > 0 && (
              <div className="p-3 rounded-lg bg-primary/10 text-center">
                <p className="text-sm font-medium">
                  <Sparkles className="inline h-4 w-4 mr-1" />
                  {trialCredits} free {trialCredits === 1 ? 'use' : 'uses'} remaining
                </p>
              </div>
            )}
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3 p-2 rounded-lg bg-primary/5">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span>Advanced analytics & tools</span>
              </div>
              <div className="flex items-start gap-3 p-2 rounded-lg bg-primary/5">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span>AI-powered insights</span>
              </div>
              <div className="flex items-start gap-3 p-2 rounded-lg bg-primary/5">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span>Unlimited ticket creation</span>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={() => navigate("/pricing")}
            >
              View Plans
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};

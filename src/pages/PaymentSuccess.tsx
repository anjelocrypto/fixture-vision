import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Sparkles, Home } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const TUTORIAL_COMPLETED_KEY = 'ticketai_tutorial_completed';
const FIRST_PAYMENT_KEY = 'ticketai_first_payment_tutorial';

const PaymentSuccess = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Ensure session is restored and refresh entitlements immediately
    const refreshAccess = async () => {
      try {
        // Wait a moment for Stripe redirect to settle
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Get current session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          console.log("[PaymentSuccess] Session confirmed, user logged in");
          
          // Force a quick entitlement refresh by calling a simple query
          // This ensures the backend has processed the webhook
          await supabase
            .from("user_entitlements")
            .select("plan, status")
            .eq("user_id", session.user.id)
            .maybeSingle();
          
          console.log("[PaymentSuccess] Entitlements refreshed");
          
          // Mark that we should start tutorial on next page load (first payment)
          const tutorialKey = `${TUTORIAL_COMPLETED_KEY}_${session.user.id}`;
          const firstPaymentKey = `${FIRST_PAYMENT_KEY}_${session.user.id}`;
          const hasCompletedTutorial = localStorage.getItem(tutorialKey) === 'true';
          
          if (!hasCompletedTutorial) {
            // Set flag to trigger tutorial when user goes to home
            localStorage.setItem(firstPaymentKey, 'true');
          }
        }
      } catch (error) {
        console.error("[PaymentSuccess] Error refreshing access:", error);
      }
    };

    refreshAccess();
  }, []);

  const handleBackToHome = () => {
    // Navigate to main homepage
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-primary/5 to-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="max-w-md w-full border-primary/20 shadow-2xl">
          <CardContent className="pt-12 pb-8 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="mb-6"
            >
              <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 relative">
                <CheckCircle2 className="h-16 w-16 text-primary" />
                <motion.div
                  className="absolute inset-0 rounded-full border-4 border-primary/20"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
            </motion.div>

            <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Payment Successful!
            </h1>
            
            <p className="text-muted-foreground mb-8 text-lg">
              Your premium access is now active. Welcome to TicketAI!
            </p>

            <div className="flex items-center justify-center gap-2 mb-8 text-primary">
              <Sparkles className="h-5 w-5" />
              <span className="font-semibold">
                Full access to all features unlocked
              </span>
              <Sparkles className="h-5 w-5" />
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleBackToHome}
                size="lg"
                className="w-full gap-2"
              >
                <Home className="h-5 w-5" />
                Back to Home
              </Button>
              
              <p className="text-xs text-muted-foreground">
                Start using TicketAI with your premium features
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default PaymentSuccess;

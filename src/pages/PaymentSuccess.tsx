import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Home, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const TUTORIAL_COMPLETED_KEY = "ticketai_tutorial_completed";
const FIRST_PAYMENT_KEY = "ticketai_first_payment_tutorial";
const MAX_AUTOMATIC_ATTEMPTS = 12;

type VerificationState = "checking" | "verified" | "pending" | "failed";

async function checkoutTrackingKey(sessionId: string): Promise<string> {
  const bytes = new TextEncoder().encode(sessionId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ticketai_checkout_tracked_${hash}`;
}

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<VerificationState>("checking");
  const [message, setMessage] = useState("Confirming your payment and premium access…");
  const trackedRef = useRef(false);

  const verify = useCallback(async () => {
    if (!sessionId) {
      setState("failed");
      setMessage("This page is missing its checkout verification code. Open Account to check your access.");
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setState("failed");
      setMessage("Sign in with the account used at checkout to verify this payment.");
      return false;
    }

    const { data, error } = await supabase.functions.invoke("verify-checkout-session", {
      body: { session_id: sessionId },
    });
    if (error) throw error;

    if (data?.verified === true) {
      setState("verified");
      setMessage("Your payment and premium access are verified.");
      if (!trackedRef.current) {
        trackedRef.current = true;
        const trackingKey = await checkoutTrackingKey(sessionId);
        if (localStorage.getItem(trackingKey) !== "true") {
          trackEvent("checkout_completed", { plan: data.plan ?? "unknown" });
          localStorage.setItem(trackingKey, "true");
        }
        const tutorialKey = `${TUTORIAL_COMPLETED_KEY}_${session.user.id}`;
        const firstPaymentKey = `${FIRST_PAYMENT_KEY}_${session.user.id}`;
        if (localStorage.getItem(tutorialKey) !== "true") {
          localStorage.setItem(firstPaymentKey, "true");
        }
      }
      return true;
    }

    if (data?.state === "processing_entitlement") {
      setState("pending");
      setMessage("Payment is confirmed. We’re waiting for premium access to finish activating.");
    } else if (data?.state === "expired") {
      setState("failed");
      setMessage("This checkout session expired and no payment was verified.");
    } else {
      setState("pending");
      setMessage("The payment is still pending confirmation.");
    }
    return false;
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async (attempt: number) => {
      try {
        const verified = await verify();
        if (cancelled || verified) return;
        if (attempt < MAX_AUTOMATIC_ATTEMPTS) {
          timeoutId = setTimeout(() => void poll(attempt + 1), 5000);
        }
      } catch (error) {
        console.error("[PaymentSuccess] Verification error", error);
        if (!cancelled && attempt < MAX_AUTOMATIC_ATTEMPTS) {
          setState("pending");
          setMessage("Verification is temporarily unavailable. We’ll check again automatically.");
          timeoutId = setTimeout(() => void poll(attempt + 1), 5000);
        } else if (!cancelled) {
          setState("failed");
          setMessage("We couldn’t verify the payment right now. Retrying verification will not create another charge.");
        }
      }
    };

    void poll(1);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [verify]);

  const retry = async () => {
    setState("checking");
    setMessage("Checking your payment and access again…");
    try {
      await verify();
    } catch (error) {
      console.error("[PaymentSuccess] Retry error", error);
      setState("failed");
      setMessage("Verification is temporarily unavailable. Please try again shortly.");
    }
  };

  const verified = state === "verified";
  const checking = state === "checking";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-background via-primary/5 to-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-primary/20 shadow-2xl">
        <CardContent className="pt-12 pb-8 text-center">
          <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            {checking || state === "pending" ? (
              <Loader2 className="h-14 w-14 text-primary animate-spin" />
            ) : verified ? (
              <CheckCircle2 className="h-16 w-16 text-primary" />
            ) : (
              <AlertCircle className="h-16 w-16 text-destructive" />
            )}
          </div>

          <h1 className="text-3xl font-bold mb-3">
            {verified ? "Payment verified" : checking ? "Verifying payment" : state === "pending" ? "Activation in progress" : "Verification needed"}
          </h1>
          <p className="text-muted-foreground mb-8 text-base">{message}</p>

          <div className="space-y-3">
            {!verified && !checking && (
              <Button onClick={() => void retry()} size="lg" className="w-full gap-2">
                <RefreshCw className="h-5 w-5" />
                Check again
              </Button>
            )}
            <Button
              onClick={() => navigate(verified ? "/" : "/account")}
              size="lg"
              variant={verified ? "default" : "outline"}
              className="w-full gap-2"
            >
              <Home className="h-5 w-5" />
              {verified ? "Start using Ticket AI" : "Open account"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSuccess;

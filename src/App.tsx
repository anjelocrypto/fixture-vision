import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TutorialProvider } from "@/contexts/TutorialContext";
import { AppShell } from "@/components/AppShell";
import { Navigate } from "react-router-dom";

const Index = lazy(() => import("./pages/Index"));
const Landing = lazy(() => import("./pages/Landing"));
const Pricing = lazy(() => import("./pages/Pricing"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const Account = lazy(() => import("./pages/Account"));
const AdminHealth = lazy(() => import("./pages/AdminHealth"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Demo = lazy(() => import("./pages/Demo"));
const Basketball = lazy(() => import("./pages/Basketball"));
const Hockey = lazy(() => import("./pages/Hockey"));
const Markets = lazy(() => import("./pages/Markets"));
const MarketDetail = lazy(() => import("./pages/MarketDetail"));
const Version = lazy(() => import("./pages/Version"));

const routeFallback = (
  <div className="min-h-dvh flex items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading page" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

const App = () => {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <BrowserRouter>
            <TutorialProvider>
              <AppShell>
                <Suspense fallback={routeFallback}>
                  <Routes>
                  <Route path="/landing" element={<Landing />} />
                  <Route path="/auth" element={<Navigate to="/landing?mode=signin" replace />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/payment-success" element={<PaymentSuccess />} />
                  <Route path="/auth/payment-success" element={<PaymentSuccess />} />
                  <Route path="/legal/terms" element={<TermsOfService />} />
                  <Route path="/legal/privacy" element={<PrivacyPolicy />} />
                  <Route path="/version" element={<Version />} />
                  <Route path="/demo" element={<Demo />} />
                  <Route path="/basketball" element={<ProtectedRoute><Basketball /></ProtectedRoute>} />
                  <Route path="/hockey" element={<ProtectedRoute><Hockey /></ProtectedRoute>} />
                  <Route path="/markets" element={<Markets />} />
                  <Route path="/markets/:id" element={<MarketDetail />} />
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <Index />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/account"
                    element={
                      <ProtectedRoute>
                        <Account />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/health"
                    element={
                      <ProtectedRoute>
                        <AdminHealth />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/winner" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </AppShell>
            </TutorialProvider>
          </BrowserRouter>
          <Toaster />
          <Sonner />
        </TooltipProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
};

export default App;

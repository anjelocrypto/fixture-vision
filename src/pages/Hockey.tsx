import { Helmet } from "react-helmet-async";
import { AppHeader } from "@/components/AppHeader";
import { Construction } from "lucide-react";

export default function Hockey() {
  return (
    <>
      <Helmet>
        <title>Hockey | TICKET AI</title>
        <meta name="description" content="Hockey fixtures, analytics, and predictions powered by TICKET AI." />
      </Helmet>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <AppHeader />
        <main className="flex-1 flex items-center justify-center p-6 pb-20 lg:pb-6">
          <div className="text-center space-y-4 max-w-md">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <span className="text-3xl">🏒</span>
            </div>
            <h1 className="text-2xl font-bold">Hockey</h1>
            <p className="text-muted-foreground">
              Hockey analytics and predictions are being built. Fixtures, team stats, and smart picks will appear here once the data pipeline is live.
            </p>
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground/60 bg-secondary/50 rounded-full px-3 py-1.5">
              <Construction className="h-3.5 w-3.5" />
              Pipeline setup in progress
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

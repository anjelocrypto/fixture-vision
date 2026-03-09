import { Activity, Snowflake } from "lucide-react";

interface IceEdgeHeroProps {
  gameCount: number;
}

export function IceEdgeHero({ gameCount }: IceEdgeHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(200,60%,12%)] via-[hsl(210,50%,10%)] to-[hsl(220,40%,8%)] border border-[hsl(200,40%,20%)] p-6 md:p-8">
      {/* Subtle ice crystal pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `radial-gradient(circle at 20% 30%, hsl(200 60% 60%) 1px, transparent 1px),
                          radial-gradient(circle at 80% 70%, hsl(200 60% 60%) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }} />
      
      <div className="relative flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-[hsl(200,60%,20%)] flex items-center justify-center">
              <Snowflake className="h-5 w-5 text-[hsl(200,70%,70%)]" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-[hsl(200,30%,95%)]">
                IceEdge
              </h1>
              <p className="text-xs text-[hsl(200,20%,55%)]">Hockey Analytics Engine</p>
            </div>
          </div>
          <p className="text-sm text-[hsl(200,15%,60%)] max-w-md">
            Next 48h board ranked by projected value, chaos, and P1 heat signals.
          </p>
        </div>
        
        <div className="flex items-center gap-1.5 bg-[hsl(200,40%,15%)] rounded-full px-3 py-1.5 border border-[hsl(200,30%,25%)]">
          <Activity className="h-3.5 w-3.5 text-[hsl(200,70%,60%)]" />
          <span className="text-xs font-medium text-[hsl(200,30%,80%)]">{gameCount} games</span>
        </div>
      </div>
    </div>
  );
}

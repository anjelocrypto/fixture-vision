import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { SafeZoneBotChat } from "./SafeZoneBotChat";

export function SafeZoneBotButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Safe Zone Bot"
        className="fixed bottom-20 lg:bottom-4 right-4 z-50 h-13 w-13 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all flex items-center justify-center hover:scale-105 active:scale-90"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ShieldCheck className="w-6 h-6" />
        {/* Pulse indicator */}
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-background animate-pulse" />
      </button>

      <SafeZoneBotChat open={open} onClose={() => setOpen(false)} />
    </>
  );
}

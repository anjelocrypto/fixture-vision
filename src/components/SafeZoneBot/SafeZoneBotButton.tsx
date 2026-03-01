import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { SafeZoneBotChat } from "./SafeZoneBotChat";

export function SafeZoneBotButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Safe Zone Bot"
        className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all flex items-center justify-center hover:scale-105 active:scale-95"
      >
        <ShieldCheck className="w-6 h-6" />
      </button>

      {/* Chat panel */}
      <SafeZoneBotChat open={open} onClose={() => setOpen(false)} />
    </>
  );
}

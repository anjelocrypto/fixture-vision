import { MarketsPanel } from "@/components/markets/MarketsPanel";
import { AppHeader } from "@/components/AppHeader";
import { Info, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

const Markets = () => {
  const { t } = useTranslation("markets");

  return (
    <div className="min-h-dvh bg-background pb-24 lg:pb-0">
      <AppHeader />
      <main className="container max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-6">
        {/* Premium Header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-3"
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 border border-primary/20">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-2xl font-bold text-foreground tracking-tight">{t("page_title")}</h1>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-semibold uppercase tracking-wider">BETA</Badge>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
                {t("page_subtitle")}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Disclaimer - more compact on mobile */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="mb-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-muted/20 border border-border/30"
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground/70">{t("disclaimer_title")}.</strong>{" "}
            {t("disclaimer_text")}
          </p>
        </motion.div>

        <MarketsPanel />
      </main>
    </div>
  );
};

export default Markets;

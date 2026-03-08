import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

interface MobileQuickActionsProps {
  onOpenTicketCreator: () => void;
  onOpenTools: () => void;
}

export function MobileQuickActions({ onOpenTicketCreator, onOpenTools }: MobileQuickActionsProps) {
  const { t } = useTranslation(['common']);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 }}
      className="lg:hidden"
    >
      <div className="flex gap-2">
        <Button
          className="flex-1 gap-2 h-12 text-sm font-semibold rounded-xl shadow-md shadow-primary/20"
          variant="default"
          onClick={onOpenTicketCreator}
        >
          <Sparkles className="h-4 w-4" />
          {t('common:ai_ticket_creator')}
        </Button>
        <Button
          className="h-12 px-4 rounded-xl"
          variant="outline"
          onClick={onOpenTools}
        >
          {t('common:analytics_tools', 'Tools')}
        </Button>
      </div>
    </motion.div>
  );
}

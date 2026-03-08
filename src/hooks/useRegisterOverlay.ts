import { useEffect, useCallback } from "react";
import { useOverlayStack } from "@/stores/useOverlayStack";

/**
 * Registers an overlay (dialog/sheet/drawer) to the global stack when open,
 * and removes it when closed. The Android back button and other consumers
 * close the topmost overlay first.
 */
export function useRegisterOverlay(
  id: string,
  isOpen: boolean,
  onClose: () => void
) {
  const push = useOverlayStack((s) => s.push);
  const remove = useOverlayStack((s) => s.remove);

  // Stable close ref
  const closeFn = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      push({ id, close: closeFn });
    } else {
      remove(id);
    }
    return () => {
      remove(id);
    };
  }, [isOpen, id, push, remove, closeFn]);
}

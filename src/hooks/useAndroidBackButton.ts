import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useOverlayStack } from "@/stores/useOverlayStack";

/**
 * Handles Android hardware back button inside Capacitor.
 * Priority:
 * 1. Close topmost overlay (dialog/sheet/drawer)
 * 2. Navigate back if not at root
 * 3. Exit app if at root (Capacitor only)
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const pop = useOverlayStack((s) => s.pop);
  const hasOverlays = useOverlayStack((s) => s.hasOverlays);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function setup() {
      try {
        const { App } = await import("@capacitor/app");

        const listener = await App.addListener("backButton", () => {
          // 1. Close topmost overlay
          if (hasOverlays()) {
            const top = pop();
            if (top) {
              top.close();
              return;
            }
          }

          // 2. Navigate back if not at root
          if (location.pathname !== "/") {
            navigate(-1);
            return;
          }

          // 3. Exit app at root
          App.exitApp();
        });

        cleanup = () => {
          listener.remove();
        };
      } catch {
        // Not running in Capacitor — no-op on web
      }
    }

    setup();

    return () => {
      cleanup?.();
    };
  }, [navigate, location.pathname, pop, hasOverlays]);
}

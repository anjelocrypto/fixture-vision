import { create } from "zustand";

/**
 * Single source of truth for the ticket drawer's open state.
 * The drawer itself is mounted exactly once, in AppShell.
 */
interface TicketDrawerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const useTicketDrawer = create<TicketDrawerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
}));

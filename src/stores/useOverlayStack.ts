import { create } from "zustand";

export interface OverlayEntry {
  id: string;
  close: () => void;
}

interface OverlayStackState {
  stack: OverlayEntry[];
  push: (entry: OverlayEntry) => void;
  pop: () => OverlayEntry | undefined;
  remove: (id: string) => void;
  hasOverlays: () => boolean;
}

export const useOverlayStack = create<OverlayStackState>((set, get) => ({
  stack: [],

  push: (entry) =>
    set((state) => ({
      stack: [...state.stack.filter((e) => e.id !== entry.id), entry],
    })),

  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const top = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });
    return top;
  },

  remove: (id) =>
    set((state) => ({
      stack: state.stack.filter((e) => e.id !== id),
    })),

  hasOverlays: () => get().stack.length > 0,
}));

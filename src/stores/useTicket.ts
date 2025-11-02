import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export type TicketLeg = {
  id: string; // `${fixtureId}-${market}-${side}-${line}`
  fixtureId: number;
  leagueId?: number;
  countryCode?: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  market: 'goals' | 'corners' | 'cards' | 'offsides' | 'fouls' | '1x2';
  side: 'over' | 'under' | 'home' | 'away' | 'draw';
  line: number | string;
  odds: number;
  bookmaker: string;
  rulesVersion: string;
  combinedAvg?: number;
  isLive: boolean;
  source: 'filterizer' | 'ticket_creator' | 'bet_optimizer' | 'winner';
};

export type TicketState = {
  legs: TicketLeg[];
  stake: number;
  createdAt: string;
  lastUpdated: string;
};

type TicketActions = {
  addLeg: (leg: TicketLeg) => void;
  removeLeg: (id: string) => void;
  clear: () => void;
  setStake: (stake: number) => void;
  refreshOdds: () => Promise<void>;
  hasLeg: (fixtureId: number, market: string) => boolean;
  loadFromStorage: () => void;
  loadFromServer: (userId: string) => Promise<void>;
  saveToServer: (userId: string) => Promise<void>;
};

const STORAGE_KEY = 'ticket_v1';
const RULES_VERSION = 'v2_combined_matrix_v1';
const ODDS_MIN = 1.25;
const ODDS_MAX = 5.00;

const persist = (state: TicketState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to persist ticket:', error);
  }
};

const loadFromLocalStorage = (): TicketState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load ticket from storage:', error);
  }
  return null;
};

export const useTicket = create<TicketState & TicketActions>((set, get) => ({
  legs: [],
  stake: 10,
  createdAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),

  loadFromStorage: () => {
    const stored = loadFromLocalStorage();
    if (stored) {
      set({
        legs: stored.legs,
        stake: stored.stake,
        createdAt: stored.createdAt,
        lastUpdated: stored.lastUpdated,
      });
    }
  },

  loadFromServer: async (userId: string) => {
    try {
      const { data, error } = await (supabase as any)
        .from('user_tickets')
        .select('ticket')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data?.ticket) {
        const serverTicket = data.ticket as TicketState;
        const localTicket = loadFromLocalStorage();

        // Merge: prefer server if it's newer
        if (!localTicket || new Date(serverTicket.lastUpdated) > new Date(localTicket.lastUpdated)) {
          set({
            legs: serverTicket.legs,
            stake: serverTicket.stake,
            createdAt: serverTicket.createdAt,
            lastUpdated: serverTicket.lastUpdated,
          });
          persist(serverTicket);
        }
      }
    } catch (error) {
      console.error('Failed to load ticket from server:', error);
    }
  },

  saveToServer: async (userId: string) => {
    const state = get();
    const ticketState: TicketState = {
      legs: state.legs,
      stake: state.stake,
      createdAt: state.createdAt,
      lastUpdated: state.lastUpdated,
    };

    try {
      const { error } = await (supabase as any)
        .from('user_tickets')
        .upsert({
          user_id: userId,
          ticket: ticketState,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to save ticket to server:', error);
    }
  },

  addLeg: (leg: TicketLeg) => {
    // Validate odds band
    if (leg.odds < ODDS_MIN || leg.odds > ODDS_MAX) {
      console.warn(`Leg rejected: odds ${leg.odds} outside band [${ODDS_MIN}, ${ODDS_MAX}]`);
      return;
    }

    set((state) => {
      const existingIndex = state.legs.findIndex(
        (l) => l.fixtureId === leg.fixtureId && l.market === leg.market
      );

      let newLegs: TicketLeg[];

      if (existingIndex >= 0) {
        // Replace if better odds
        const existing = state.legs[existingIndex];
        if (leg.odds > existing.odds) {
          newLegs = [...state.legs];
          newLegs[existingIndex] = leg;
          console.log(`Updated leg with better odds: ${leg.odds} > ${existing.odds}`);
        } else {
          // Keep existing
          return state;
        }
      } else {
        // Add new leg
        newLegs = [...state.legs, leg];
      }

      const newState = {
        ...state,
        legs: newLegs,
        lastUpdated: new Date().toISOString(),
      };

      persist(newState);
      return newState;
    });
  },

  removeLeg: (id: string) => {
    set((state) => {
      const newState = {
        ...state,
        legs: state.legs.filter((leg) => leg.id !== id),
        lastUpdated: new Date().toISOString(),
      };
      persist(newState);
      return newState;
    });
  },

  clear: () => {
    const newState = {
      legs: [],
      stake: 10,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    set(newState);
    persist(newState);
  },

  setStake: (stake: number) => {
    set((state) => {
      const newState = {
        ...state,
        stake,
        lastUpdated: new Date().toISOString(),
      };
      persist(newState);
      return newState;
    });
  },

  refreshOdds: async () => {
    const state = get();
    if (state.legs.length === 0) return;

    try {
      const { data, error } = await supabase.functions.invoke('get-latest-odds', {
        body: {
          legs: state.legs.map((leg) => ({
            fixtureId: leg.fixtureId,
            market: leg.market,
            side: leg.side,
            line: leg.line,
          })),
        },
      });

      if (error) throw error;

      if (data?.updates) {
        set((state) => {
          const updatedLegs = state.legs.map((leg) => {
            const update = data.updates.find(
              (u: any) =>
                u.fixtureId === leg.fixtureId &&
                u.market === leg.market &&
                u.side === leg.side &&
                u.line === leg.line
            );

            if (update && update.odds) {
              return {
                ...leg,
                odds: update.odds,
                bookmaker: update.bookmaker || leg.bookmaker,
              };
            }
            return leg;
          });

          const newState = {
            ...state,
            legs: updatedLegs,
            lastUpdated: new Date().toISOString(),
          };

          persist(newState);
          return newState;
        });
      }
    } catch (error) {
      console.error('Failed to refresh odds:', error);
    }
  },

  hasLeg: (fixtureId: number, market: string) => {
    return get().legs.some((leg) => leg.fixtureId === fixtureId && leg.market === market);
  },
}));

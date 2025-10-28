export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      analysis_cache: {
        Row: {
          computed_at: string | null
          fixture_id: number
          summary_json: Json
        }
        Insert: {
          computed_at?: string | null
          fixture_id: number
          summary_json: Json
        }
        Update: {
          computed_at?: string | null
          fixture_id?: number
          summary_json?: Json
        }
        Relationships: []
      }
      countries: {
        Row: {
          code: string | null
          created_at: string | null
          flag: string | null
          id: number
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          flag?: string | null
          id: number
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string | null
          flag?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      fixtures: {
        Row: {
          created_at: string | null
          date: string
          id: number
          league_id: number | null
          status: string | null
          teams_away: Json
          teams_home: Json
          timestamp: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id: number
          league_id?: number | null
          status?: string | null
          teams_away: Json
          teams_home: Json
          timestamp?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: number
          league_id?: number | null
          status?: string | null
          teams_away?: Json
          teams_home?: Json
          timestamp?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_tickets: {
        Row: {
          created_at: string | null
          id: string
          legs: Json
          max_target: number
          min_target: number
          total_odds: number
          used_live: boolean
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          legs: Json
          max_target: number
          min_target: number
          total_odds: number
          used_live?: boolean
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          legs?: Json
          max_target?: number
          min_target?: number
          total_odds?: number
          used_live?: boolean
          user_id?: string
        }
        Relationships: []
      }
      leagues: {
        Row: {
          country_id: number | null
          created_at: string | null
          id: number
          logo: string | null
          name: string
          season: number
        }
        Insert: {
          country_id?: number | null
          created_at?: string | null
          id: number
          logo?: string | null
          name: string
          season: number
        }
        Update: {
          country_id?: number | null
          created_at?: string | null
          id?: number
          logo?: string | null
          name?: string
          season?: number
        }
        Relationships: [
          {
            foreignKeyName: "leagues_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      odds_cache: {
        Row: {
          bookmakers: string[] | null
          captured_at: string | null
          fixture_id: number
          markets: string[] | null
          payload: Json
        }
        Insert: {
          bookmakers?: string[] | null
          captured_at?: string | null
          fixture_id: number
          markets?: string[] | null
          payload: Json
        }
        Update: {
          bookmakers?: string[] | null
          captured_at?: string | null
          fixture_id?: number
          markets?: string[] | null
          payload?: Json
        }
        Relationships: []
      }
      optimized_selections: {
        Row: {
          bookmaker: string | null
          combined_snapshot: Json | null
          computed_at: string | null
          country_code: string | null
          edge_pct: number | null
          fixture_id: number
          id: string
          is_live: boolean | null
          league_id: number
          line: number
          market: string
          model_prob: number | null
          odds: number
          rules_version: string | null
          sample_size: number | null
          side: string
          source: string | null
          utc_kickoff: string
        }
        Insert: {
          bookmaker?: string | null
          combined_snapshot?: Json | null
          computed_at?: string | null
          country_code?: string | null
          edge_pct?: number | null
          fixture_id: number
          id?: string
          is_live?: boolean | null
          league_id: number
          line: number
          market: string
          model_prob?: number | null
          odds: number
          rules_version?: string | null
          sample_size?: number | null
          side: string
          source?: string | null
          utc_kickoff: string
        }
        Update: {
          bookmaker?: string | null
          combined_snapshot?: Json | null
          computed_at?: string | null
          country_code?: string | null
          edge_pct?: number | null
          fixture_id?: number
          id?: string
          is_live?: boolean | null
          league_id?: number
          line?: number
          market?: string
          model_prob?: number | null
          odds?: number
          rules_version?: string | null
          sample_size?: number | null
          side?: string
          source?: string | null
          utc_kickoff?: string
        }
        Relationships: []
      }
      optimizer_cache: {
        Row: {
          bookmaker: string | null
          combined_value: number
          computed_at: string | null
          fixture_id: number
          id: string
          line: number
          market: string
          odds: number | null
          side: string
          source: string | null
        }
        Insert: {
          bookmaker?: string | null
          combined_value: number
          computed_at?: string | null
          fixture_id: number
          id?: string
          line: number
          market: string
          odds?: number | null
          side: string
          source?: string | null
        }
        Update: {
          bookmaker?: string | null
          combined_value?: number
          computed_at?: string | null
          fixture_id?: number
          id?: string
          line?: number
          market?: string
          odds?: number | null
          side?: string
          source?: string | null
        }
        Relationships: []
      }
      optimizer_run_logs: {
        Row: {
          duration_ms: number | null
          failed: number | null
          finished_at: string | null
          id: string
          notes: string | null
          run_type: string
          scanned: number | null
          scope: Json | null
          skipped: number | null
          started_at: string
          upserted: number | null
          window_end: string
          window_start: string
          with_odds: number | null
        }
        Insert: {
          duration_ms?: number | null
          failed?: number | null
          finished_at?: string | null
          id?: string
          notes?: string | null
          run_type: string
          scanned?: number | null
          scope?: Json | null
          skipped?: number | null
          started_at?: string
          upserted?: number | null
          window_end: string
          window_start: string
          with_odds?: number | null
        }
        Update: {
          duration_ms?: number | null
          failed?: number | null
          finished_at?: string | null
          id?: string
          notes?: string | null
          run_type?: string
          scanned?: number | null
          scope?: Json | null
          skipped?: number | null
          started_at?: string
          upserted?: number | null
          window_end?: string
          window_start?: string
          with_odds?: number | null
        }
        Relationships: []
      }
      stats_cache: {
        Row: {
          cards: number
          computed_at: string | null
          corners: number
          fouls: number
          goals: number
          last_final_fixture: number | null
          last_five_fixture_ids: number[] | null
          offsides: number
          sample_size: number
          source: string | null
          team_id: number
        }
        Insert: {
          cards?: number
          computed_at?: string | null
          corners?: number
          fouls?: number
          goals?: number
          last_final_fixture?: number | null
          last_five_fixture_ids?: number[] | null
          offsides?: number
          sample_size?: number
          source?: string | null
          team_id: number
        }
        Update: {
          cards?: number
          computed_at?: string | null
          corners?: number
          fouls?: number
          goals?: number
          last_final_fixture?: number | null
          last_five_fixture_ids?: number[] | null
          offsides?: number
          sample_size?: number
          source?: string | null
          team_id?: number
        }
        Relationships: []
      }
      user_entitlements: {
        Row: {
          current_period_end: string
          plan: string
          source: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end: string
          plan: string
          source?: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string
          plan?: string
          source?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_tickets: {
        Row: {
          ticket: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          ticket: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          ticket?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_trial_credits: {
        Row: {
          remaining_uses: number
          updated_at: string
          user_id: string
        }
        Insert: {
          remaining_uses?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          remaining_uses?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          event_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      current_user_is_whitelisted: {
        Row: {
          is_whitelisted: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      backfill_optimized_selections: {
        Args: never
        Returns: {
          inserted: number
          scanned: number
          skipped: number
        }[]
      }
      ensure_trial_row: { Args: never; Returns: undefined }
      get_trial_credits: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_user_whitelisted: { Args: never; Returns: boolean }
      try_use_feature: {
        Args: { feature_key: string }
        Returns: {
          allowed: boolean
          reason: string
          remaining_uses: number
        }[]
      }
      user_has_access: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const

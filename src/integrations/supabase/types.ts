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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
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
          id?: number
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
      cron_job_locks: {
        Row: {
          job_name: string
          locked_at: string | null
          locked_by: string | null
          locked_until: string
        }
        Insert: {
          job_name: string
          locked_at?: string | null
          locked_by?: string | null
          locked_until: string
        }
        Update: {
          job_name?: string
          locked_at?: string | null
          locked_by?: string | null
          locked_until?: string
        }
        Relationships: []
      }
      fixture_results: {
        Row: {
          cards_away: number | null
          cards_home: number | null
          corners_away: number | null
          corners_home: number | null
          fetched_at: string
          finished_at: string
          fixture_id: number
          fouls_away: number | null
          fouls_home: number | null
          goals_away: number
          goals_home: number
          kickoff_at: string
          league_id: number
          offsides_away: number | null
          offsides_home: number | null
          source: string
          status: string
        }
        Insert: {
          cards_away?: number | null
          cards_home?: number | null
          corners_away?: number | null
          corners_home?: number | null
          fetched_at?: string
          finished_at?: string
          fixture_id: number
          fouls_away?: number | null
          fouls_home?: number | null
          goals_away: number
          goals_home: number
          kickoff_at: string
          league_id: number
          offsides_away?: number | null
          offsides_home?: number | null
          source?: string
          status?: string
        }
        Update: {
          cards_away?: number | null
          cards_home?: number | null
          corners_away?: number | null
          corners_home?: number | null
          fetched_at?: string
          finished_at?: string
          fixture_id?: number
          fouls_away?: number | null
          fouls_home?: number | null
          goals_away?: number
          goals_home?: number
          kickoff_at?: string
          league_id?: number
          offsides_away?: number | null
          offsides_home?: number | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_results_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: true
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
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
      h2h_cache: {
        Row: {
          cards: number
          computed_at: string
          corners: number
          fouls: number
          goals: number
          last_fixture_ids: number[]
          offsides: number
          sample_size: number
          team1_id: number
          team2_id: number
        }
        Insert: {
          cards?: number
          computed_at?: string
          corners?: number
          fouls?: number
          goals?: number
          last_fixture_ids?: number[]
          offsides?: number
          sample_size?: number
          team1_id: number
          team2_id: number
        }
        Update: {
          cards?: number
          computed_at?: string
          corners?: number
          fouls?: number
          goals?: number
          last_fixture_ids?: number[]
          offsides?: number
          sample_size?: number
          team1_id?: number
          team2_id?: number
        }
        Relationships: []
      }
      league_stats_coverage: {
        Row: {
          cards_coverage_pct: number | null
          corners_coverage_pct: number | null
          country: string | null
          created_at: string | null
          fixtures_with_cards: number
          fixtures_with_corners: number
          fixtures_with_fouls: number
          fixtures_with_goals: number
          fixtures_with_offsides: number
          fouls_coverage_pct: number | null
          goals_coverage_pct: number | null
          is_cup: boolean
          last_checked_at: string | null
          league_id: number
          league_name: string
          offsides_coverage_pct: number | null
          skip_cards: boolean | null
          skip_corners: boolean | null
          skip_fouls: boolean | null
          skip_goals: boolean | null
          skip_offsides: boolean | null
          total_fixtures: number
        }
        Insert: {
          cards_coverage_pct?: number | null
          corners_coverage_pct?: number | null
          country?: string | null
          created_at?: string | null
          fixtures_with_cards?: number
          fixtures_with_corners?: number
          fixtures_with_fouls?: number
          fixtures_with_goals?: number
          fixtures_with_offsides?: number
          fouls_coverage_pct?: number | null
          goals_coverage_pct?: number | null
          is_cup?: boolean
          last_checked_at?: string | null
          league_id: number
          league_name: string
          offsides_coverage_pct?: number | null
          skip_cards?: boolean | null
          skip_corners?: boolean | null
          skip_fouls?: boolean | null
          skip_goals?: boolean | null
          skip_offsides?: boolean | null
          total_fixtures?: number
        }
        Update: {
          cards_coverage_pct?: number | null
          corners_coverage_pct?: number | null
          country?: string | null
          created_at?: string | null
          fixtures_with_cards?: number
          fixtures_with_corners?: number
          fixtures_with_fouls?: number
          fixtures_with_goals?: number
          fixtures_with_offsides?: number
          fouls_coverage_pct?: number | null
          goals_coverage_pct?: number | null
          is_cup?: boolean
          last_checked_at?: string | null
          league_id?: number
          league_name?: string
          offsides_coverage_pct?: number | null
          skip_cards?: boolean | null
          skip_corners?: boolean | null
          skip_fouls?: boolean | null
          skip_goals?: boolean | null
          skip_offsides?: boolean | null
          total_fixtures?: number
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
          odds: number | null
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
          odds?: number | null
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
          odds?: number | null
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
      outcome_selections: {
        Row: {
          bookmaker: string
          computed_at: string
          edge_pct: number | null
          fixture_id: number
          id: number
          league_id: number
          market_type: string
          model_prob: number | null
          odds: number
          outcome: string
          utc_kickoff: string
        }
        Insert: {
          bookmaker: string
          computed_at?: string
          edge_pct?: number | null
          fixture_id: number
          id?: number
          league_id: number
          market_type: string
          model_prob?: number | null
          odds: number
          outcome: string
          utc_kickoff: string
        }
        Update: {
          bookmaker?: string
          computed_at?: string
          edge_pct?: number | null
          fixture_id?: number
          id?: number
          league_id?: number
          market_type?: string
          model_prob?: number | null
          odds?: number
          outcome?: string
          utc_kickoff?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcome_selections_fixture_fk"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_selections_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      player_importance: {
        Row: {
          assists: number | null
          goals: number | null
          importance: number
          last_update: string
          league_id: number
          matches_played: number | null
          matches_started: number | null
          minutes_played: number | null
          player_id: number
          season: number
          team_id: number
        }
        Insert: {
          assists?: number | null
          goals?: number | null
          importance: number
          last_update?: string
          league_id: number
          matches_played?: number | null
          matches_started?: number | null
          minutes_played?: number | null
          player_id: number
          season: number
          team_id: number
        }
        Update: {
          assists?: number | null
          goals?: number | null
          importance?: number
          last_update?: string
          league_id?: number
          matches_played?: number | null
          matches_started?: number | null
          minutes_played?: number | null
          player_id?: number
          season?: number
          team_id?: number
        }
        Relationships: []
      }
      player_injuries: {
        Row: {
          expected_return: string | null
          injury_type: string | null
          last_update: string
          league_id: number
          player_id: number
          player_name: string
          position: string | null
          season: number
          start_date: string | null
          status: string | null
          team_id: number
          team_name: string
        }
        Insert: {
          expected_return?: string | null
          injury_type?: string | null
          last_update?: string
          league_id: number
          player_id: number
          player_name: string
          position?: string | null
          season: number
          start_date?: string | null
          status?: string | null
          team_id: number
          team_name: string
        }
        Update: {
          expected_return?: string | null
          injury_type?: string | null
          last_update?: string
          league_id?: number
          player_id?: number
          player_name?: string
          position?: string | null
          season?: number
          start_date?: string | null
          status?: string | null
          team_id?: number
          team_name?: string
        }
        Relationships: []
      }
      predictions_cache: {
        Row: {
          advice: string | null
          away_prob: number | null
          cached_at: string
          draw_prob: number | null
          fixture_id: number
          home_prob: number | null
          league_id: number
        }
        Insert: {
          advice?: string | null
          away_prob?: number | null
          cached_at?: string
          draw_prob?: number | null
          fixture_id: number
          home_prob?: number | null
          league_id: number
        }
        Update: {
          advice?: string | null
          away_prob?: number | null
          cached_at?: string
          draw_prob?: number | null
          fixture_id?: number
          home_prob?: number | null
          league_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "predictions_cache_fixture_fk"
            columns: ["fixture_id"]
            isOneToOne: true
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          preferred_lang: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          preferred_lang?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          preferred_lang?: string
          updated_at?: string
          user_id?: string
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
      team_totals_candidates: {
        Row: {
          computed_at: string
          fixture_id: number
          id: number
          league_id: number
          line: number
          opponent_recent_conceded_2plus: number | null
          opponent_season_conceding_rate: number | null
          recent_sample_size: number | null
          rules_passed: boolean
          rules_version: string
          season_scoring_rate: number | null
          team_context: string
          team_id: number
          utc_kickoff: string
        }
        Insert: {
          computed_at?: string
          fixture_id: number
          id?: number
          league_id: number
          line?: number
          opponent_recent_conceded_2plus?: number | null
          opponent_season_conceding_rate?: number | null
          recent_sample_size?: number | null
          rules_passed?: boolean
          rules_version?: string
          season_scoring_rate?: number | null
          team_context: string
          team_id: number
          utc_kickoff: string
        }
        Update: {
          computed_at?: string
          fixture_id?: number
          id?: number
          league_id?: number
          line?: number
          opponent_recent_conceded_2plus?: number | null
          opponent_season_conceding_rate?: number | null
          recent_sample_size?: number | null
          rules_passed?: boolean
          rules_version?: string
          season_scoring_rate?: number | null
          team_context?: string
          team_id?: number
          utc_kickoff?: string
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
      backtest_samples: {
        Row: {
          book_odds: number | null
          bookmaker: string | null
          cards_away: number | null
          cards_home: number | null
          combined_snapshot: Json | null
          corners_away: number | null
          corners_home: number | null
          created_at: string | null
          edge_pct: number | null
          finished_at: string | null
          fixture_id: number | null
          goals_away: number | null
          goals_home: number | null
          hours_to_kickoff: number | null
          kickoff_at: string | null
          league_id: number | null
          line: number | null
          market: string | null
          model_prob: number | null
          result_win: boolean | null
          sample_size: number | null
          selection_id: string | null
          side: string | null
        }
        Relationships: []
      }
      best_outcome_prices: {
        Row: {
          bookmaker: string | null
          computed_at: string | null
          edge_pct: number | null
          fixture_id: number | null
          id: number | null
          league_id: number | null
          market_type: string | null
          model_prob: number | null
          odds: number | null
          outcome: string | null
          rk: number | null
          utc_kickoff: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_selections_fixture_fk"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_selections_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_health_check: {
        Row: {
          active_pipeline_cron_jobs: number | null
          checked_at: string | null
          coverage_pct: number | null
          fresh_stats: number | null
          health_status: string | null
          last_stats_batch: string | null
          last_warmup_optimizer: string | null
          stats_batch_minutes_ago: number | null
          total_cron_jobs: number | null
          total_teams: number | null
          warmup_minutes_ago: number | null
        }
        Relationships: []
      }
      v_best_outcome_prices_prematch: {
        Row: {
          bookmaker: string | null
          computed_at: string | null
          edge_pct: number | null
          fixture_id: number | null
          id: number | null
          league_id: number | null
          market_type: string | null
          model_prob: number | null
          odds: number | null
          outcome: string | null
          rk: number | null
          utc_kickoff: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_selections_fixture_fk"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_selections_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      v_is_subscriber: {
        Row: {
          is_subscriber: boolean | null
          user_id: string | null
        }
        Relationships: []
      }
      v_outcomes_prematch: {
        Row: {
          bookmaker: string | null
          computed_at: string | null
          edge_pct: number | null
          fixture_id: number | null
          id: number | null
          league_id: number | null
          market_type: string | null
          model_prob: number | null
          odds: number | null
          outcome: string | null
          utc_kickoff: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_selections_fixture_fk"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_selections_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      v_problematic_cups: {
        Row: {
          cards_coverage_pct: number | null
          corners_coverage_pct: number | null
          country: string | null
          fouls_coverage_pct: number | null
          goals_coverage_pct: number | null
          last_checked_at: string | null
          league_id: number | null
          league_name: string | null
          offsides_coverage_pct: number | null
          skip_cards: boolean | null
          skip_corners: boolean | null
          skip_fouls: boolean | null
          skip_goals: boolean | null
          skip_offsides: boolean | null
          total_fixtures: number | null
        }
        Insert: {
          cards_coverage_pct?: number | null
          corners_coverage_pct?: number | null
          country?: string | null
          fouls_coverage_pct?: number | null
          goals_coverage_pct?: number | null
          last_checked_at?: string | null
          league_id?: number | null
          league_name?: string | null
          offsides_coverage_pct?: number | null
          skip_cards?: boolean | null
          skip_corners?: boolean | null
          skip_fouls?: boolean | null
          skip_goals?: boolean | null
          skip_offsides?: boolean | null
          total_fixtures?: number | null
        }
        Update: {
          cards_coverage_pct?: number | null
          corners_coverage_pct?: number | null
          country?: string | null
          fouls_coverage_pct?: number | null
          goals_coverage_pct?: number | null
          last_checked_at?: string | null
          league_id?: number | null
          league_name?: string | null
          offsides_coverage_pct?: number | null
          skip_cards?: boolean | null
          skip_corners?: boolean | null
          skip_fouls?: boolean | null
          skip_goals?: boolean | null
          skip_offsides?: boolean | null
          total_fixtures?: number | null
        }
        Relationships: []
      }
      v_selections_prematch: {
        Row: {
          bookmaker: string | null
          combined_snapshot: Json | null
          computed_at: string | null
          country_code: string | null
          edge_pct: number | null
          fixture_id: number | null
          id: string | null
          is_live: boolean | null
          league_id: number | null
          line: number | null
          market: string | null
          model_prob: number | null
          odds: number | null
          rules_version: string | null
          sample_size: number | null
          side: string | null
          source: string | null
          utc_kickoff: string | null
        }
        Relationships: []
      }
      v_team_totals_prematch: {
        Row: {
          computed_at: string | null
          fixture_id: number | null
          fixture_status: string | null
          id: number | null
          league_id: number | null
          league_name: string | null
          line: number | null
          opponent_recent_conceded_2plus: number | null
          opponent_season_conceding_rate: number | null
          recent_sample_size: number | null
          rules_passed: boolean | null
          rules_version: string | null
          season_scoring_rate: number | null
          team_context: string | null
          team_id: number | null
          teams_away: Json | null
          teams_home: Json | null
          utc_kickoff: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_cron_lock: {
        Args: { p_duration_minutes?: number; p_job_name: string }
        Returns: boolean
      }
      backfill_optimized_selections: {
        Args: never
        Returns: {
          inserted: number
          scanned: number
          skipped: number
        }[]
      }
      ensure_trial_row: { Args: never; Returns: undefined }
      get_cron_internal_key: { Args: never; Returns: string }
      get_trial_credits: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_user_subscriber: { Args: { check_user_id?: string }; Returns: boolean }
      is_user_whitelisted: { Args: never; Returns: boolean }
      release_cron_lock: { Args: { p_job_name: string }; Returns: undefined }
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

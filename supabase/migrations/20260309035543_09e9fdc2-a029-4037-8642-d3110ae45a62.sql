
-- ============================================================
-- PHASE A: IceEdge 48H – Hockey schema
-- ============================================================

-- 1. hockey_leagues  (composite PK: id + season)
CREATE TABLE public.hockey_leagues (
  id         integer   NOT NULL,
  season     integer   NOT NULL,
  name       text      NOT NULL,
  country    text,
  logo       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, season)
);

ALTER TABLE public.hockey_leagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read hockey_leagues"
  ON public.hockey_leagues FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manage hockey_leagues"
  ON public.hockey_leagues FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER set_hockey_leagues_updated_at
  BEFORE UPDATE ON public.hockey_leagues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. hockey_teams  (provider ID as PK, no league binding)
CREATE TABLE public.hockey_teams (
  id         integer   PRIMARY KEY,
  name       text      NOT NULL,
  short_name text,
  logo       text,
  country    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hockey_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read hockey_teams"
  ON public.hockey_teams FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manage hockey_teams"
  ON public.hockey_teams FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER set_hockey_teams_updated_at
  BEFORE UPDATE ON public.hockey_teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. hockey_games
CREATE TABLE public.hockey_games (
  id              integer     PRIMARY KEY,
  league_id       integer     NOT NULL,
  season          integer     NOT NULL,
  home_team_id    integer     NOT NULL REFERENCES public.hockey_teams(id),
  away_team_id    integer     NOT NULL REFERENCES public.hockey_teams(id),
  puck_drop       timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'NS',
  home_score      smallint,
  away_score      smallint,
  period_scores   jsonb,
  went_to_ot      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (league_id, season) REFERENCES public.hockey_leagues(id, season)
);

ALTER TABLE public.hockey_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read hockey_games"
  ON public.hockey_games FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manage hockey_games"
  ON public.hockey_games FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_hockey_games_puck_drop ON public.hockey_games(puck_drop);
CREATE INDEX idx_hockey_games_league_season ON public.hockey_games(league_id, season);
CREATE INDEX idx_hockey_games_status ON public.hockey_games(status);

CREATE TRIGGER set_hockey_games_updated_at
  BEFORE UPDATE ON public.hockey_games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. hockey_odds_cache  (service-only, normalized)
CREATE TABLE public.hockey_odds_cache (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id    integer     NOT NULL REFERENCES public.hockey_games(id),
  bookmaker  text        NOT NULL,
  market     text        NOT NULL,
  selection  text        NOT NULL,
  line       numeric     NOT NULL DEFAULT 0,
  odds       numeric     NOT NULL CHECK (odds > 1),
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, bookmaker, market, selection, line)
);

ALTER TABLE public.hockey_odds_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage hockey_odds_cache"
  ON public.hockey_odds_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_hockey_odds_game_market ON public.hockey_odds_cache(game_id, market);
CREATE INDEX idx_hockey_odds_game_bookmaker ON public.hockey_odds_cache(game_id, bookmaker);

-- 5. hockey_team_stats_cache  (composite PK)
CREATE TABLE public.hockey_team_stats_cache (
  team_id          integer     NOT NULL REFERENCES public.hockey_teams(id),
  league_id        integer     NOT NULL,
  season           integer     NOT NULL,
  gp               integer     NOT NULL DEFAULT 0,
  gpg              numeric     NOT NULL DEFAULT 0,
  ga_pg            numeric     NOT NULL DEFAULT 0,
  pp_pct           numeric     NOT NULL DEFAULT 0,
  pk_pct           numeric     NOT NULL DEFAULT 0,
  sog_pg           numeric     NOT NULL DEFAULT 0,
  sa_pg            numeric     NOT NULL DEFAULT 0,
  p1_gpg           numeric     NOT NULL DEFAULT 0,
  p1_gapg          numeric     NOT NULL DEFAULT 0,
  ot_pct           numeric     NOT NULL DEFAULT 0,
  last5_gpg        numeric     NOT NULL DEFAULT 0,
  last5_gapg       numeric     NOT NULL DEFAULT 0,
  last5_game_ids   integer[]   NOT NULL DEFAULT '{}',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, league_id, season),
  FOREIGN KEY (league_id, season) REFERENCES public.hockey_leagues(id, season)
);

ALTER TABLE public.hockey_team_stats_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage hockey_team_stats_cache"
  ON public.hockey_team_stats_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER set_hockey_team_stats_updated_at
  BEFORE UPDATE ON public.hockey_team_stats_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. hockey_h2h_cache  (canonical ordering)
CREATE TABLE public.hockey_h2h_cache (
  team_lo          integer     NOT NULL REFERENCES public.hockey_teams(id),
  team_hi          integer     NOT NULL REFERENCES public.hockey_teams(id),
  gp               integer     NOT NULL DEFAULT 0,
  avg_total_goals  numeric     NOT NULL DEFAULT 0,
  ot_pct           numeric     NOT NULL DEFAULT 0,
  last_game_ids    integer[]   NOT NULL DEFAULT '{}',
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_lo, team_hi),
  CHECK (team_lo < team_hi)
);

ALTER TABLE public.hockey_h2h_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage hockey_h2h_cache"
  ON public.hockey_h2h_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 7. hockey_iceedge_cache  (client-facing, with check constraints)
CREATE TABLE public.hockey_iceedge_cache (
  game_id           integer     PRIMARY KEY REFERENCES public.hockey_games(id),
  league_id         integer     NOT NULL,
  season            integer     NOT NULL,
  home_team_id      integer     NOT NULL REFERENCES public.hockey_teams(id),
  away_team_id      integer     NOT NULL REFERENCES public.hockey_teams(id),
  puck_drop         timestamptz NOT NULL,
  projected_total   numeric     NOT NULL DEFAULT 0,
  value_score       numeric     NOT NULL DEFAULT 0 CHECK (value_score >= 0 AND value_score <= 100),
  chaos_score       numeric     NOT NULL DEFAULT 0 CHECK (chaos_score >= 0 AND chaos_score <= 100),
  ot_risk           numeric     NOT NULL DEFAULT 0 CHECK (ot_risk >= 0 AND ot_risk <= 100),
  p1_heat           numeric     NOT NULL DEFAULT 0 CHECK (p1_heat >= 0 AND p1_heat <= 100),
  iceedge_rank      integer,
  confidence_tier   text        NOT NULL DEFAULT 'medium' CHECK (confidence_tier IN ('high','medium','low')),
  regulation_lean   text        NOT NULL DEFAULT 'toss-up' CHECK (regulation_lean IN ('home','away','toss-up')),
  recommended_markets jsonb     NOT NULL DEFAULT '[]',
  reasoning         text,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (league_id, season) REFERENCES public.hockey_leagues(id, season)
);

ALTER TABLE public.hockey_iceedge_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read hockey_iceedge_cache"
  ON public.hockey_iceedge_cache FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manage hockey_iceedge_cache"
  ON public.hockey_iceedge_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_iceedge_puck_drop ON public.hockey_iceedge_cache(puck_drop);
CREATE INDEX idx_iceedge_rank ON public.hockey_iceedge_cache(iceedge_rank);
CREATE INDEX idx_iceedge_league_season ON public.hockey_iceedge_cache(league_id, season);

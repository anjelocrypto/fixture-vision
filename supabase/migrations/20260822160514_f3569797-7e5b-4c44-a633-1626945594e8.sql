BEGIN;

CREATE TABLE IF NOT EXISTS public.green_bucket_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'active', 'retired', 'rejected')),
  policy_mode text NOT NULL DEFAULT 'learned'
    CHECK (policy_mode IN ('learned', 'bootstrap')),
  window_start timestamptz,
  window_end timestamptz,
  source_leg_count integer NOT NULL DEFAULT 0 CHECK (source_leg_count >= 0),
  bucket_count integer NOT NULL DEFAULT 0 CHECK (bucket_count >= 0),
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS green_bucket_one_active_policy_idx
  ON public.green_bucket_policy_versions ((status))
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.green_bucket_policy_entries (
  policy_version_id uuid NOT NULL
    REFERENCES public.green_bucket_policy_versions(id) ON DELETE CASCADE,
  league_id integer NOT NULL,
  market text NOT NULL CHECK (market IN ('goals', 'corners')),
  side text NOT NULL CHECK (side = 'over'),
  line_norm numeric NOT NULL CHECK (line_norm > 0),
  odds_band text NOT NULL,
  sample_size integer NOT NULL CHECK (sample_size >= 50),
  wins integer NOT NULL CHECK (wins >= 0),
  losses integer NOT NULL CHECK (losses >= 0),
  hit_rate_pct numeric NOT NULL CHECK (hit_rate_pct BETWEEN 65 AND 100),
  roi_pct numeric NOT NULL CHECK (roi_pct >= -2),
  PRIMARY KEY (policy_version_id, league_id, market, side, line_norm, odds_band),
  CHECK (wins + losses = sample_size)
);

CREATE INDEX IF NOT EXISTS green_bucket_policy_entries_lookup_idx
  ON public.green_bucket_policy_entries
    (policy_version_id, league_id, market, side, line_norm, odds_band);

ALTER TABLE public.green_bucket_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_bucket_policy_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.green_bucket_policy_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.green_bucket_policy_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.green_bucket_policy_versions TO service_role;
GRANT ALL ON public.green_bucket_policy_entries TO service_role;

CREATE OR REPLACE FUNCTION public.activate_green_bucket_policy(
  p_rows jsonb,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_source_leg_count integer,
  p_thresholds jsonb,
  p_diagnostics jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version_id uuid;
  v_expected integer;
  v_inserted integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR p_window_start IS NULL
     OR p_window_end <= p_window_start OR p_source_leg_count < 1 THEN
    RAISE EXCEPTION 'invalid green-policy payload';
  END IF;

  v_expected := jsonb_array_length(p_rows);
  IF v_expected < 1 THEN
    RAISE EXCEPTION 'refusing to replace the active policy with zero buckets';
  END IF;

  INSERT INTO public.green_bucket_policy_versions (
    status, policy_mode, window_start, window_end, source_leg_count,
    bucket_count, thresholds, diagnostics
  )
  VALUES (
    'staged', 'learned', p_window_start, p_window_end, p_source_leg_count,
    v_expected, COALESCE(p_thresholds, '{}'::jsonb),
    COALESCE(p_diagnostics, '{}'::jsonb)
  )
  RETURNING id INTO v_version_id;

  INSERT INTO public.green_bucket_policy_entries (
    policy_version_id, league_id, market, side, line_norm, odds_band,
    sample_size, wins, losses, hit_rate_pct, roi_pct
  )
  SELECT
    v_version_id, row_data.league_id, row_data.market, row_data.side,
    row_data.line_norm, row_data.odds_band, row_data.sample_size,
    row_data.wins, row_data.losses, row_data.hit_rate_pct, row_data.roi_pct
  FROM jsonb_to_recordset(p_rows) AS row_data(
    league_id integer,
    market text,
    side text,
    line_norm numeric,
    odds_band text,
    sample_size integer,
    wins integer,
    losses integer,
    hit_rate_pct numeric,
    roi_pct numeric
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_expected THEN
    RAISE EXCEPTION 'expected % buckets, inserted %', v_expected, v_inserted;
  END IF;

  UPDATE public.green_bucket_policy_versions
  SET status = 'retired', retired_at = now()
  WHERE status = 'active';

  UPDATE public.green_bucket_policy_versions
  SET status = 'active', activated_at = now()
  WHERE id = v_version_id;

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_green_bucket_policy(jsonb,timestamptz,timestamptz,integer,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_green_bucket_policy(jsonb,timestamptz,timestamptz,integer,jsonb,jsonb)
  TO service_role;

COMMIT;
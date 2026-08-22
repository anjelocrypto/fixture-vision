-- SAFETY GUARD
--
-- The files after this one are Lovable's historical production event log.
-- They contain old project URLs, old anon JWTs, environment-specific cron
-- commands, and one-off production data operations. They are not a clean
-- installer and must not be replayed into a new project.
--
-- Replace the legacy directory with an audited schema-only baseline generated
-- from the source database before running `supabase db push`.
DO $$
BEGIN
  RAISE EXCEPTION
    'TICKET_AI_LEGACY_REPLAY_BLOCKED: generate and review a clean baseline using migration/README.md';
END;
$$;

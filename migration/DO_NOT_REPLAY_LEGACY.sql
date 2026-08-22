-- SAFETY GUARD FOR MANUAL CLEAN-PROJECT MIGRATION WORK ONLY.
--
-- This file intentionally lives outside supabase/migrations so Lovable cannot
-- auto-apply it to the existing production project. The historical migration
-- directory is a production event log, not a clean installer.
DO $$
BEGIN
  RAISE EXCEPTION
    'TICKET_AI_LEGACY_REPLAY_BLOCKED: generate and review a clean baseline using migration/README.md';
END;
$$;

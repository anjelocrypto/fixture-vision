REVOKE ALL ON FUNCTION public.fixtures_record_schedule_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tlo_protect_pick_time_metadata() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fixtures_record_schedule_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.tlo_protect_pick_time_metadata() TO service_role;
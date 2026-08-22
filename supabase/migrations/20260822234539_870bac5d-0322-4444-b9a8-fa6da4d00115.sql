REVOKE EXECUTE ON FUNCTION public.is_user_subscriber(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_trial_row() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.try_use_feature(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_market_stats() FROM authenticated;
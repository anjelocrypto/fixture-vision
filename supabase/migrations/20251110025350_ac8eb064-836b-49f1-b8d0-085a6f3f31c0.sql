-- Restrict is_user_subscriber to authenticated users and service role only
REVOKE EXECUTE ON FUNCTION public.is_user_subscriber(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_user_subscriber(uuid) TO authenticated, service_role;
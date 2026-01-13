-- Grant admin role to primary admin user
INSERT INTO public.user_roles (user_id, role)
VALUES ('496d15f1-60c0-4be1-b3a2-b26961ce55ca', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
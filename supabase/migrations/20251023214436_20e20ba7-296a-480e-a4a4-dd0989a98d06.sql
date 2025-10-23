-- ============================================
-- ROLE-BASED ACCESS CONTROL SYSTEM
-- ============================================

-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create user_roles table (separate from profiles to prevent privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 4. Add user_id to generated_tickets so users can own their tickets
ALTER TABLE public.generated_tickets 
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX idx_generated_tickets_user_id ON public.generated_tickets(user_id);

-- ============================================
-- UPDATE RLS POLICIES - PROTECT BUSINESS DATA
-- ============================================

-- Drop all existing policies
DROP POLICY IF EXISTS "Countries are viewable by authenticated users" ON public.countries;
DROP POLICY IF EXISTS "Service role can manage countries" ON public.countries;
DROP POLICY IF EXISTS "Leagues are viewable by authenticated users" ON public.leagues;
DROP POLICY IF EXISTS "Service role can manage leagues" ON public.leagues;
DROP POLICY IF EXISTS "Fixtures are viewable by authenticated users" ON public.fixtures;
DROP POLICY IF EXISTS "Service role can manage fixtures" ON public.fixtures;
DROP POLICY IF EXISTS "Analysis cache is viewable by authenticated users" ON public.analysis_cache;
DROP POLICY IF EXISTS "Service role can manage analysis cache" ON public.analysis_cache;
DROP POLICY IF EXISTS "Odds cache is viewable by authenticated users" ON public.odds_cache;
DROP POLICY IF EXISTS "Service role can manage odds cache" ON public.odds_cache;
DROP POLICY IF EXISTS "Optimizer cache readable (auth)" ON public.optimizer_cache;
DROP POLICY IF EXISTS "Service role manage optimizer" ON public.optimizer_cache;
DROP POLICY IF EXISTS "Stats cache is viewable by authenticated users" ON public.stats_cache;
DROP POLICY IF EXISTS "Service role can manage stats cache" ON public.stats_cache;
DROP POLICY IF EXISTS "Tickets readable (auth)" ON public.generated_tickets;
DROP POLICY IF EXISTS "Service role manage tickets" ON public.generated_tickets;

-- ============================================
-- PUBLIC SPORTS DATA (countries, leagues, fixtures)
-- These are public sports information, safe to share
-- ============================================

-- Countries: Public sports data
CREATE POLICY "Anyone can view countries" 
ON public.countries 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage countries" 
ON public.countries 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Leagues: Public sports data
CREATE POLICY "Anyone can view leagues" 
ON public.leagues 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage leagues" 
ON public.leagues 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Fixtures: Public sports data
CREATE POLICY "Anyone can view fixtures" 
ON public.fixtures 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage fixtures" 
ON public.fixtures 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- PROTECTED BUSINESS INTELLIGENCE
-- Only admins and service role can access
-- ============================================

-- Analysis Cache: Proprietary analysis algorithms
CREATE POLICY "Only admins can view analysis cache" 
ON public.analysis_cache 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage analysis cache" 
ON public.analysis_cache 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Odds Cache: Real-time competitive odds data
CREATE POLICY "Only admins can view odds cache" 
ON public.odds_cache 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage odds cache" 
ON public.odds_cache 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Optimizer Cache: Betting optimization strategy
CREATE POLICY "Only admins can view optimizer cache" 
ON public.optimizer_cache 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage optimizer cache" 
ON public.optimizer_cache 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Stats Cache: Statistical analysis data
CREATE POLICY "Only admins can view stats cache" 
ON public.stats_cache 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage stats cache" 
ON public.stats_cache 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- USER-SPECIFIC DATA (generated_tickets)
-- Users can only see their own tickets
-- ============================================

-- Generated Tickets: Users can view only their own tickets
CREATE POLICY "Users can view their own tickets" 
ON public.generated_tickets 
FOR SELECT 
USING (auth.uid() = user_id);

-- Admins can view all tickets
CREATE POLICY "Admins can view all tickets" 
ON public.generated_tickets 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Users can insert their own tickets
CREATE POLICY "Users can create their own tickets" 
ON public.generated_tickets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Service role can manage all tickets
CREATE POLICY "Service role can manage tickets" 
ON public.generated_tickets 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- USER ROLES TABLE POLICIES
-- ============================================

-- Only admins can view all roles
CREATE POLICY "Admins can view all user roles" 
ON public.user_roles 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Users can view their own roles
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
USING (auth.uid() = user_id);

-- Only admins can manage roles
CREATE POLICY "Only admins can manage user roles" 
ON public.user_roles 
FOR ALL 
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Service role can manage all roles
CREATE POLICY "Service role can manage all user roles" 
ON public.user_roles 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
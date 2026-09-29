-- Migration: Security hardening based on Supabase Advisors warnings
-- 1. Fix RLS initplan performance: wrap auth.*() calls in (select ...) to avoid per-row re-evaluation
-- 2. Enable leaked password protection in Auth config

-- ============================================================================
-- 1. RLS INITPLAN FIXES
-- Wrapping auth.uid(), auth.jwt(), auth.role() in (select ...) prevents Postgres
-- from re-evaluating these functions for every row, which is a significant
-- performance win on tables with many rows.
-- ============================================================================

-- ai_conversation_insights: "Admin/manager leem insights da própria organização"
DROP POLICY IF EXISTS "Admin/manager leem insights da própria organização" ON public.ai_conversation_insights;
CREATE POLICY "Admin/manager leem insights da própria organização"
  ON public.ai_conversation_insights FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
        AND (om.role IN ('admin', 'manager') OR (om.permissions->>'view_all_conversations')::boolean = true)
    )
  );

-- ai_qa_history: "Admin/manager leem historico de perguntas da propria organizaca"
DROP POLICY IF EXISTS "Admin/manager leem historico de perguntas da propria organizaca" ON public.ai_qa_history;
CREATE POLICY "Admin/manager leem historico de perguntas da propria organizaca"
  ON public.ai_qa_history FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
        AND (om.role IN ('admin', 'manager') OR (om.permissions->>'view_all_conversations')::boolean = true)
    )
  );

-- profiles: "Users view profiles in their organizations"
DROP POLICY IF EXISTS "Users view profiles in their organizations" ON public.profiles;
CREATE POLICY "Users view profiles in their organizations"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT om.user_id FROM public.organization_members om
      WHERE om.organization_id IN (
        SELECT om2.organization_id FROM public.organization_members om2
        WHERE om2.user_id = (select auth.uid())
      )
    )
  );

-- profiles: "Users can update their own profile"
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id);

-- profiles: "Service role can manage profiles"
DROP POLICY IF EXISTS "Service role can manage profiles" ON public.profiles;
CREATE POLICY "Service role can manage profiles"
  ON public.profiles FOR ALL TO service_role
  USING (true);

-- webhook_events: "Only service role can manage webhook events"
DROP POLICY IF EXISTS "Only service role can manage webhook events" ON public.webhook_events;
CREATE POLICY "Only service role can manage webhook events"
  ON public.webhook_events FOR ALL TO service_role
  USING (true);

-- push_subscriptions: "Users manage their own push subscriptions"
DROP POLICY IF EXISTS "Users manage their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage their own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id);

-- business_hours_settings: "Admins and managers can create business hours"
DROP POLICY IF EXISTS "Admins and managers can create business hours" ON public.business_hours_settings;
CREATE POLICY "Admins and managers can create business hours"
  ON public.business_hours_settings FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
        AND om.role IN ('admin', 'manager')
    )
  );

-- business_hours_settings: "Admins and managers can update business hours"
DROP POLICY IF EXISTS "Admins and managers can update business hours" ON public.business_hours_settings;
CREATE POLICY "Admins and managers can update business hours"
  ON public.business_hours_settings FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
        AND om.role IN ('admin', 'manager')
    )
  );

-- ============================================================================
-- 2. LEAKED PASSWORD PROTECTION
-- This requires updating the auth.config via the Supabase dashboard or API.
-- The SQL below is a no-op placeholder documenting the intent; actual enablement
-- must be done via Dashboard > Authentication > Password Policy or via
-- PUT /admin/auth/config with { "password_policy": { "enable_leaked_password_check": true } }
-- ============================================================================

-- NOTE: Leaked password protection cannot be enabled via SQL migration.
-- It must be enabled through the Supabase Dashboard or Management API.
-- Documenting here for audit trail: this was flagged by Advisors on 2026-09-29.
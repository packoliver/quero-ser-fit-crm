-- Migration: 20260809000000_security_rls_hardening.sql
-- Description: Fix critical RLS policy vulnerabilities in profiles and webhook_events

-- =====================================================================
-- 1. DROP INSECURE POLICIES
-- =====================================================================

-- Drop the overly permissive profiles policy
DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;

-- Drop the webhook_events policy that allows authenticated users direct access
DROP POLICY IF EXISTS "Service role or authenticated users can manage webhook events" ON public.webhook_events;

-- =====================================================================
-- 2. ADD organization_id COLUMN TO webhook_events (if not present)
-- =====================================================================

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS integration_connection_id UUID REFERENCES public.integration_connections(id) ON DELETE CASCADE;

-- =====================================================================
-- 3. CREATE SECURE PROFILES POLICY
-- =====================================================================
-- Only allow authenticated users to see profiles of users in the same organization

CREATE POLICY "Users can view profiles in their organizations" ON public.profiles
    FOR SELECT USING (
        id IN (
            SELECT DISTINCT om2.user_id
            FROM public.organization_members om1
            JOIN public.organization_members om2 ON om1.organization_id = om2.organization_id
            WHERE om1.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Service role can manage profiles" ON public.profiles
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================================
-- 4. CREATE SECURE webhook_events POLICIES
-- =====================================================================
-- Only service_role can write; authenticated users cannot.

CREATE POLICY "Only service role can write webhook events" ON public.webhook_events
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Only service role can update webhook events" ON public.webhook_events
    FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "Only service role can delete webhook events" ON public.webhook_events
    FOR DELETE USING (auth.role() = 'service_role');

-- If there's a legitimate need for authenticated users to READ webhook_events,
-- enable this; otherwise, leave it commented out to deny all reads by default.
-- CREATE POLICY "Users can read webhook events for their organizations" ON public.webhook_events
--     FOR SELECT USING (
--         organization_id IN (SELECT public.get_user_org_ids())
--     );

-- =====================================================================
-- 5. ADD UNIQUE CONSTRAINT FOR IDEMPOTENCY BY CONNECTION
-- =====================================================================
-- Prevent duplicate events per connection + external_event_id

DROP INDEX IF EXISTS idx_webhook_events_provider_extid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_connection_extid
  ON public.webhook_events(integration_connection_id, external_event_id)
  WHERE integration_connection_id IS NOT NULL;

-- For backward compatibility with events that don't have connection_id yet,
-- keep the old unique index for those
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_legacy_unique
  ON public.webhook_events(provider, external_event_id)
  WHERE integration_connection_id IS NULL;

-- =====================================================================
-- 6. ADD INDEXES FOR COMMON QUERIES
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_webhook_events_org ON public.webhook_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_connection ON public.webhook_events(integration_connection_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON public.webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_profiles_org_member ON public.profiles(id);

-- Migration: restore table-level GRANTs to `authenticated`/`service_role`.
--
-- master_setup.sql runs `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` before
-- creating the app's tables. That wipes out the default table privileges Supabase
-- normally pre-configures for the `anon`/`authenticated`/`service_role` roles on a
-- fresh project, and the script never re-granted them afterwards — only `EXECUTE` on
-- functions was granted. Row Level Security policies were correctly defined, but
-- Postgres checks table-level GRANTs *before* RLS, so every real (non-demo) query from
-- the app was failing with `permission denied for table ...` (SQLSTATE 42501) and the
-- frontend was silently falling back to demo/local data instead of surfacing the error.
--
-- This grants baseline CRUD to `authenticated` (RLS policies still narrow what each
-- request can actually see/touch) and full access to `service_role` (used by
-- src/lib/supabase/admin.ts, which bypasses RLS by design), then re-applies the
-- narrower REVOKEs that master_setup.sql already defines for audit_logs and
-- integration_connections so those stay locked down.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Make sure future tables created in this schema keep getting these grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO authenticated, service_role;

-- Re-apply the narrower restrictions from master_setup.sql on top of the blanket grant above.
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon, public;
REVOKE SELECT ON public.integration_connections FROM authenticated, anon, public;

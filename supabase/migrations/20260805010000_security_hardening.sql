-- Migration: 20260805010000_security_hardening.sql
-- Description: Phase 1.1 Security Hardening: SET search_path='', Revoke EXECUTE from PUBLIC, Server-Only audit_logs, View-Only integration metadata

-- 1. Hardening SECURITY DEFINER Functions with SET search_path = '' and Schema Qualification
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
    SELECT organization_id 
    FROM public.organization_members 
    WHERE user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.organization_members 
        WHERE organization_id = org_id 
          AND user_id = (SELECT auth.uid()) 
          AND role = 'admin'
    );
$$;

-- Revoke execute from PUBLIC and anon, grant only to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.get_user_org_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_org_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID) TO authenticated, service_role;

-- 2. Audit Logs Server-Only Append-Only Enforcement
-- Revoke INSERT, UPDATE, DELETE on audit_logs for authenticated users and public
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon, public;

-- Drop existing audit_logs policies to recreate strict server-only read policies for admins
DROP POLICY IF EXISTS "Tenant isolation for audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can select audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;

CREATE POLICY "Admins can select audit_logs" ON public.audit_logs
    FOR SELECT USING (public.is_org_admin(organization_id));

-- 3. Integration Connections Table Revocation & Metadata View
-- Revoke direct SELECT on integration_connections table to prevent browser access to encrypted_credentials
REVOKE SELECT ON public.integration_connections FROM authenticated, anon, public;

-- Create secure public metadata view excluding encrypted_credentials
CREATE OR REPLACE VIEW public.integration_connections_public AS
    SELECT 
        id,
        organization_id,
        provider,
        status,
        settings,
        created_at,
        updated_at
    FROM public.integration_connections;

-- Grant SELECT on the non-sensitive view to authenticated users
GRANT SELECT ON public.integration_connections_public TO authenticated, service_role;

-- 4. External Identifier Global Uniqueness Constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_channels_global_extid
    ON public.contact_channels (channel_type, external_id);

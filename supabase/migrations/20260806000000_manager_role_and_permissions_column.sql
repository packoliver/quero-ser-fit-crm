-- Migration: add 'manager' role and granular `permissions` column to organization_members.
--
-- The frontend (Configurações > Equipe) has selected/cycled through the 'manager' role and
-- read/written an `organization_members.permissions` JSONB column since the granular
-- permissions matrix feature was added, but the underlying schema was never migrated to
-- match. Any real (non-demo) query against `organization_members` that selects
-- `permissions` currently fails, silently falling back to demo mode in the UI. This
-- migration brings the schema in line with what the app already assumes.

-- 1. Allow 'manager' alongside 'admin' and 'attendant'.
ALTER TABLE public.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE public.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN ('admin', 'manager', 'attendant'));

-- 2. Granular custom permissions overrides (nullable; falls back to role defaults in app code).
ALTER TABLE public.organization_members
    ADD COLUMN IF NOT EXISTS permissions JSONB;

COMMENT ON COLUMN public.organization_members.permissions IS
    'Per-member permission overrides. NULL means "use the default permission set for this role" (see src/lib/security/permissions.ts).';

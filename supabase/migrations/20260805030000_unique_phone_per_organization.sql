-- Migration: 20260805030000_unique_phone_per_organization.sql
-- Description: DB-level unique constraint for normalized phone numbers within the same organization

-- Partial unique index on contacts table for normalized phone numbers
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_normalized_phone
    ON public.contacts (organization_id, public.normalize_phone(phone))
    WHERE phone IS NOT NULL AND public.normalize_phone(phone) <> '';

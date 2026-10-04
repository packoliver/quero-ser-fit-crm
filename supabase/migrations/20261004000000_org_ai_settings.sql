-- Migration: Add per-organization AI gateway settings
-- Date: 2026-10-04
-- Allows admins to configure OmniRoute (or any OpenAI-compatible gateway) URL,
-- API key and model directly in the CRM admin panel, removing the need for
-- server-side environment variables per tenant.

-- Step 1: Add AI settings columns to organizations table
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_gateway_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_gateway_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS ai_gateway_model TEXT;

COMMENT ON COLUMN public.organizations.ai_gateway_url IS 'Base URL do gateway de IA (ex: https://api.omniroute.online/v1). NULL = usa env var global OMNIROUTE_BASE_URL.';
COMMENT ON COLUMN public.organizations.ai_gateway_api_key_encrypted IS 'API key criptografada com AES-256-GCM via encryptToken(). Nunca armazene em plaintext.';
COMMENT ON COLUMN public.organizations.ai_gateway_model IS 'Modelo/rota do gateway (ex: auto/cheap, gpt-4o-mini). NULL = usa default do client.ts.';

-- Step 2: RLS — only organization members can read their own org's AI settings
-- The existing organizations table already has RLS enabled with policies that
-- restrict access to members. Since we're adding columns to an existing table
-- (not creating a new one), the existing SELECT/UPDATE policies on organizations
-- automatically cover these new columns. No additional policies needed.

-- Step 3: Verify
-- After applying, confirm with:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'organizations' AND column_name LIKE 'ai_gateway%';
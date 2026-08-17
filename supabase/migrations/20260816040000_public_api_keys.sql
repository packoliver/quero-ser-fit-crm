-- Migration: chaves de API pra integração externa (Zapier, planilhas, Make, scripts).
--
-- Só a hash SHA-256 da chave é guardada (`key_hash`) — igual senha, nunca em texto
-- puro — então a chave real só existe uma vez, no momento em que é gerada, e o usuário
-- precisa copiar ali mesmo. `key_prefix` guarda só os primeiros caracteres (ex:
-- "crm_a1b2c3...") só pra identificação visual na lista, nunca o suficiente pra
-- reconstruir a chave.
--
-- SELECT é revogado de `authenticated` (só quem cria a chave vê o valor completo, na
-- hora da criação, via retorno da API — nunca lido de volta do banco) — mesmo padrão
-- de integration_connections.encrypted_credentials.

CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys(key_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Membros da org veem a LISTA (nome, prefixo, datas) pra gerenciar — nunca o hash.
CREATE POLICY "Tenant isolation for api_keys" ON public.api_keys
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

-- A API pública (que recebe a chave em texto puro do cliente, calcula o hash e busca
-- aqui) roda com o client admin (service role) — não precisa de política extra além do
-- isolamento por tenant já garantido pelo hash ser único.
REVOKE SELECT (key_hash) ON public.api_keys FROM authenticated, anon;

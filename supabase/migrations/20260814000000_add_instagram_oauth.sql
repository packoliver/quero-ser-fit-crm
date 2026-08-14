-- Permite que conexões do Instagram Login sejam distinguidas das conexões manuais.
ALTER TABLE public.integration_connections
  DROP CONSTRAINT IF EXISTS integration_connections_connection_method_check;

ALTER TABLE public.integration_connections
  ADD CONSTRAINT integration_connections_connection_method_check
  CHECK (connection_method IN ('cloud_api', 'oauth', 'uazapi'));

-- O índice de roteamento existente é parcial (external_identifier IS NOT NULL),
-- portanto não pode ser usado diretamente pelo onConflict do Supabase.
-- Esta constraint cobre a chave usada pelo upsert OAuth.
ALTER TABLE public.integration_connections
  ADD CONSTRAINT integration_connections_org_provider_identifier_unique
  UNIQUE (organization_id, provider, external_identifier);

DROP INDEX IF EXISTS integration_connections_org_provider_identifier_key;

COMMENT ON COLUMN public.integration_connections.external_identifier IS
  'Identificador externo usado para rotear eventos recebidos para a conexão correta.';

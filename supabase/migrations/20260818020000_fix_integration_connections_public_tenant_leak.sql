-- A view integration_connections_public (criada em 20260805010000_security_hardening.sql
-- pra dar aos usuários uma leitura "segura" das conexões, sem expor encrypted_credentials)
-- era dona do papel `postgres`, que tem BYPASSRLS no Supabase — então, por padrão (sem
-- security_invoker), ela ignorava a política de isolamento por organização da tabela base
-- e devolvia as conexões de TODAS as organizações do projeto pra qualquer usuário
-- autenticado, não só as da própria empresa dele. Achado pelo Supabase Advisor (nível
-- ERROR) em 2026-08-18 durante auditoria pré-lançamento, e já corrigido ao vivo no banco
-- na hora — esta migration só documenta a correção no histórico.
--
-- Corrige com security_invoker=true (Postgres 15+): a partir de agora a view usa as
-- permissões/RLS de quem está consultando, não do dono da view. Como o SELECT direto na
-- tabela tinha sido revogado de `authenticated` (só a view podia ser lida), sem uma
-- concessão de coluna a view passaria a negar acesso pra todo mundo — por isso o GRANT
-- abaixo, limitado só às colunas não-sensíveis (nunca encrypted_credentials, api_base_url,
-- webhook_secret, external_identifier).
GRANT SELECT (id, organization_id, provider, status, settings, created_at, updated_at)
  ON public.integration_connections TO authenticated;

ALTER VIEW public.integration_connections_public SET (security_invoker = true);

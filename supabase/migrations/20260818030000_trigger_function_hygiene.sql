-- Limpeza de higiene apontada pelo Supabase Advisor (nível WARN) em 2026-08-18, já
-- aplicada ao vivo no banco — esta migration só documenta no histórico.

-- Essas 3 funções só existem pra rodar como gatilho interno (BEFORE INSERT) — usam NEW,
-- que só existe em contexto de trigger, então chamá-las direto via RPC sempre falharia de
-- qualquer forma. Mas EXECUTE continuava concedido a anon/authenticated, permitindo a
-- tentativa de chamada direta (/rest/v1/rpc/...) por qualquer um, inclusive sem login —
-- revoga por higiene, sem impacto nenhum no funcionamento dos gatilhos em si (que não
-- dependem dessa concessão).
REVOKE EXECUTE ON FUNCTION public.set_internal_note_defaults() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_organization_id_from_caller() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_outbound_attempt_updated_at() FROM anon, authenticated, public;

-- search_path mutável (WARN) — mesmo padrão de search_path fixo já usado em todas as
-- outras funções do projeto.
CREATE OR REPLACE FUNCTION public.set_push_subscription_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

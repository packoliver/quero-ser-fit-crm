-- Deixa de baixar o histórico inteiro pra montar a lista de conversas.
--
-- O Inbox buscava TODAS as mensagens da organização a cada atualização — e atualiza ao
-- abrir, a cada mensagem que chega, ao voltar pra aba e ao reconectar. Com 1.044 mensagens
-- isso já era ~1,4 MB por atualização, num aparelho no 4G, e crescendo (934 mensagens
-- entraram em 24h). Além do peso, o PostgREST corta em 1.000 linhas por padrão: passando
-- disso, as mensagens MAIS NOVAS começam a ficar de fora silenciosamente, porque a busca
-- vinha ordenada da mais antiga pra mais nova.
--
-- Aqui ficam as duas consultas que substituem aquilo. Nenhuma tabela, coluna ou política é
-- alterada — só leitura, e nada do que já existe muda de comportamento.

-- ---------------------------------------------------------------------------
-- 1. Lista de conversas com a última mensagem embutida
-- ---------------------------------------------------------------------------
-- security_invoker = true é OBRIGATÓRIO aqui. Sem isso a view roda com os poderes de quem
-- a criou (postgres, que ignora RLS) e passaria por cima do isolamento por organização —
-- exatamente o vazamento encontrado em integration_connections_public
-- (ver 20260818020000_fix_integration_connections_public_tenant_leak.sql). Com ele, o RLS
-- de conversations, contacts, profiles e messages vale normalmente pra quem consulta.
--
-- Os dados de contato e responsável vêm embutidos de propósito, em vez de embed do
-- PostgREST: view não carrega metadado de chave estrangeira, então `contacts(...)` não
-- funcionaria — e resolver no SQL é mais rápido do que o embed seria.
create or replace view public.conversation_list_view
with (security_invoker = true) as
select
  c.id,
  c.organization_id,
  c.contact_id,
  c.status,
  c.channel_type,
  c.current_assignee_id,
  c.last_message_at,
  c.csat_score,
  ct.name       as contact_name,
  ct.phone      as contact_phone,
  ct.is_group   as contact_is_group,
  ct.avatar_url as contact_avatar_url,
  pr.full_name  as assignee_name,
  lm.content     as last_message_content,
  lm.media_type  as last_message_media_type,
  lm.sender_type as last_message_sender_type,
  lm.created_at  as last_message_created_at
from public.conversations c
left join public.contacts ct on ct.id = c.contact_id
left join public.profiles pr on pr.id = c.current_assignee_id
-- LATERAL com LIMIT 1: pega só a última mensagem de cada conversa sem trazer as outras.
left join lateral (
  select m.content, m.media_type, m.sender_type, m.created_at
  from public.messages m
  where m.conversation_id = c.id
  order by m.created_at desc
  limit 1
) lm on true;

grant select on public.conversation_list_view to authenticated;

-- Sustenta o ORDER BY ... LIMIT 1 do lateral acima. Sem ele, cada conversa varreria todas
-- as suas mensagens só pra descobrir a última.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Contagem de não lidas, feita no banco
-- ---------------------------------------------------------------------------
-- Antes o navegador baixava todas as mensagens só pra contar quantas eram mais novas que a
-- marca de leitura. Agora o banco devolve o número pronto: uma linha por conversa que tem
-- alguma não lida.
--
-- SECURITY INVOKER (o padrão, explicitado aqui pra ficar claro que é intencional): a função
-- enxerga exatamente o que quem chamou enxerga, então o isolamento por organização e a
-- política de conversation_reads continuam valendo dentro dela.
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.conversation_id, count(*)::bigint
  from public.messages m
  left join public.conversation_reads r
    on r.conversation_id = m.conversation_id
   and r.user_id = (select auth.uid())
  where m.sender_type = 'contact'
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.conversation_id;
$$;

grant execute on function public.get_unread_counts() to authenticated;

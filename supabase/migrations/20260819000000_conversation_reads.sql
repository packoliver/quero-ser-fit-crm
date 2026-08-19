-- Não lidas por conversa, por pessoa.
--
-- O CRM não tinha NENHUMA noção de "lido": toda conversa parecia igual na lista e não havia
-- como saber onde se parou. Uma linha por pessoa por conversa, guardando até quando aquela
-- pessoa já viu aquela conversa.
--
-- Por PESSOA e não por conversa, de propósito: com mais de uma vendedora atendendo a mesma
-- caixa, marcar como lida para uma faria o aviso sumir para a outra — que é exatamente o
-- erro que faz um cliente ficar sem resposta.

create table if not exists public.conversation_reads (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Até quando esta pessoa já viu esta conversa. Mensagem do cliente mais nova que isso
  -- conta como não lida. É o único carimbo que importa aqui — não existe updated_at
  -- separado porque teria sempre o mesmo valor deste campo.
  last_read_at timestamptz not null default now(),
  -- Uma linha só por pessoa/conversa; é também o alvo de conflito usado pelo upsert na
  -- hora de marcar como lida.
  primary key (conversation_id, user_id)
);

-- O Inbox lê sempre "todas as minhas marcas de leitura" (filtra só por user_id), e a chave
-- primária começa por conversation_id — então ela não serve para essa consulta.
create index if not exists conversation_reads_user_idx
  on public.conversation_reads (user_id, conversation_id);

-- organization_id preenchida a partir de quem está chamando, igual a tasks e deals: o
-- cliente nunca envia esse campo, então não há como errar nem forjar a organização.
drop trigger if exists trg_autofill_org_conversation_reads on public.conversation_reads;
create trigger trg_autofill_org_conversation_reads
  before insert on public.conversation_reads
  for each row execute function public.set_organization_id_from_caller();

alter table public.conversation_reads enable row level security;

-- Mesma forma da política de push_subscriptions, que já roda em produção. As duas condições
-- importam: só user_id deixaria ler marcas de outra empresa caso um id vazasse; só
-- organization_id deixaria uma colega zerar o aviso da outra.
drop policy if exists "Users manage their own conversation reads" on public.conversation_reads;
create policy "Users manage their own conversation reads"
  on public.conversation_reads for all to authenticated
  using      (user_id = (select auth.uid()) and organization_id in (select public.get_user_org_ids()))
  with check (user_id = (select auth.uid()) and organization_id in (select public.get_user_org_ids()));

grant select, insert, update, delete on public.conversation_reads to authenticated;

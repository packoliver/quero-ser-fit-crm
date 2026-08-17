-- Migration: etapas do funil de vendas personalizáveis pelo admin (pipeline_stages).
--
-- Até agora as etapas do Kanban (Lead, Negociando, Fechado, Entrega, Pós-venda, Perdido)
-- eram uma lista fixa no código (STAGES em funil/page.tsx, duplicada em DEAL_STAGES no
-- Inbox) e um CHECK constraint no banco — só alterável mexendo em TypeScript e fazendo
-- deploy. `pipeline_stages` move essa definição pro banco, por organização, editável
-- pela própria administradora em Configurações > Etapas do Funil, sem precisar de dev.
--
-- `position` define a ordem das colunas no Kanban. `is_won`/`is_lost` marcam qual etapa
-- representa venda fechada (dispara `closed_at` no deal) e qual representa perda — sem
-- depender de um nome de etapa fixo tipo 'fechado'/'perdido', já que agora é texto livre
-- escolhido pelo admin.
CREATE TABLE public.pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    position INT NOT NULL DEFAULT 0,
    is_won BOOLEAN NOT NULL DEFAULT false,
    is_lost BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, key)
);

CREATE INDEX idx_pipeline_stages_org_position ON public.pipeline_stages(organization_id, position);

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pipeline_stages" ON public.pipeline_stages
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE TRIGGER trg_autofill_org_pipeline_stages
    BEFORE INSERT ON public.pipeline_stages
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

CREATE OR REPLACE FUNCTION public.set_pipeline_stages_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pipeline_stages_updated_at
    BEFORE UPDATE ON public.pipeline_stages
    FOR EACH ROW EXECUTE FUNCTION public.set_pipeline_stages_updated_at();

-- Realtime: uma etapa renomeada/criada por um admin aparece pra todo mundo no Funil e no
-- Inbox sem precisar recarregar a página — mesmo padrão de public.deals.
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_stages;

-- Semeia, pra cada organização já existente, as 6 etapas que até agora eram fixas no
-- código — mesma ordem/cores/rótulos do Kanban atual, então nenhum pedido existente
-- muda de etapa quando essa migration roda.
INSERT INTO public.pipeline_stages (organization_id, key, label, color, position, is_won, is_lost)
SELECT o.id, s.key, s.label, s.color, s.position, s.is_won, s.is_lost
FROM public.organizations o
CROSS JOIN (VALUES
    ('lead', 'Lead', 'slate', 0, false, false),
    ('negociando', 'Negociando', 'amber', 1, false, false),
    ('fechado', 'Fechado', 'emerald', 2, true, false),
    ('entrega', 'Entrega', 'teal', 3, false, false),
    ('posvenda', 'Pós-venda', 'indigo', 4, false, false),
    ('perdido', 'Perdido', 'rose', 5, false, true)
) AS s(key, label, color, position, is_won, is_lost)
ON CONFLICT (organization_id, key) DO NOTHING;

-- Solta o CHECK fixo em deals.stage — a partir de agora as etapas válidas vêm de
-- pipeline_stages (validado na camada de aplicação, mesmo padrão usado pra
-- quick_replies.shortcut e tags.name: texto livre, sem enum rígido no banco). Localiza o
-- constraint pelo conteúdo (em vez de assumir o nome default do Postgres) e derruba só
-- ele — não mexe em NOT NULL nem em nenhuma outra regra da coluna.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'deals'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%fechado%'
    LOOP
        EXECUTE format('ALTER TABLE public.deals DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

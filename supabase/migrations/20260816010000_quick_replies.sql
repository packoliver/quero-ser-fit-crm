-- Migration: respostas rápidas (mensagens prontas) — biblioteca de textos reutilizáveis
-- por organização, pra atendente não digitar a mesma resposta toda hora no Inbox.
--
-- Compartilhada pela equipe inteira (não é "minhas respostas" por atendente) — mesmo
-- modelo do resto do app (tags, deals): qualquer membro da organização lê/cria/edita/
-- apaga, isolado só por organization_id. `shortcut` é opcional pra quem quiser digitar
-- um atalho tipo "/entrega" no futuro; hoje a inserção é só por clique na lista.

CREATE TABLE IF NOT EXISTS public.quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    shortcut TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_org_shortcut_unique
    ON public.quick_replies (organization_id, shortcut)
    WHERE shortcut IS NOT NULL AND shortcut <> '';

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for quick_replies" ON public.quick_replies
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

-- Table-level GRANTs are inherited automatically for authenticated/service_role — see
-- the `ALTER DEFAULT PRIVILEGES` in 20260806010000_grant_table_privileges.sql, which
-- applies to every table created afterwards, this one included.

-- Reuses the same autofill trigger function every other org-scoped table uses (see
-- 20260806050000_fix_schema_gaps_and_autofill_org.sql) — no client-side insert needs to
-- pass organization_id explicitly.
DROP TRIGGER IF EXISTS trg_autofill_org_quick_replies ON public.quick_replies;
CREATE TRIGGER trg_autofill_org_quick_replies
    BEFORE INSERT ON public.quick_replies
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

DROP TRIGGER IF EXISTS trg_quick_replies_updated_at ON public.quick_replies;
CREATE OR REPLACE FUNCTION public.set_quick_reply_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_quick_replies_updated_at
    BEFORE UPDATE ON public.quick_replies
    FOR EACH ROW EXECUTE FUNCTION public.set_quick_reply_updated_at();

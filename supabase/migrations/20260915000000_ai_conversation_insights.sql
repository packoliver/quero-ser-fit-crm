-- Migration: tabela de resultados da análise de conversas por IA (Gemini) — feature
-- "Insights". Uma linha por conversa, sobrescrita a cada nova análise (UNIQUE em
-- conversation_id) — não é histórico, é o estado mais recente conhecido daquela conversa:
-- se está fluindo bem, precisa de atenção, ou já fechou (ganha/perdida) e por quê.
--
-- Só o service-role (o servidor, via src/lib/ai/insights.ts) escreve aqui — daí não ter
-- policy de INSERT/UPDATE/DELETE pra `authenticated`: a chave de service role ignora RLS.
-- Leitura é restrita a admin/manager (não attendant) porque isto expõe, por vendedor(a),
-- quais negociações ela perdeu e por quê — dado sensível de desempenho, mesmo padrão de
-- quem pode ver Equipe/Automações (ver ADMIN_ONLY_HREFS em src/lib/navigation.ts).
CREATE TABLE public.ai_conversation_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'atencao', 'risco')),
    signals JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT,
    outcome TEXT NOT NULL DEFAULT 'aberta' CHECK (outcome IN ('aberta', 'ganha', 'perdida')),
    outcome_reason TEXT,
    last_analyzed_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    last_analyzed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id)
);

CREATE INDEX idx_ai_conversation_insights_org_outcome ON public.ai_conversation_insights(organization_id, outcome);
CREATE INDEX idx_ai_conversation_insights_org_status ON public.ai_conversation_insights(organization_id, status);
CREATE INDEX idx_ai_conversation_insights_deal ON public.ai_conversation_insights(deal_id);

ALTER TABLE public.ai_conversation_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/manager leem insights da própria organização" ON public.ai_conversation_insights
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = ai_conversation_insights.organization_id
              AND om.user_id = auth.uid()
              AND om.role IN ('admin', 'manager')
        )
    );

CREATE OR REPLACE FUNCTION public.set_ai_conversation_insights_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ai_conversation_insights_updated_at
    BEFORE UPDATE ON public.ai_conversation_insights
    FOR EACH ROW EXECUTE FUNCTION public.set_ai_conversation_insights_updated_at();

-- Realtime: a tela de Insights atualiza sozinha assim que uma análise nova chega, sem
-- precisar recarregar — mesmo padrão de public.deals e public.pipeline_stages.
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_conversation_insights;

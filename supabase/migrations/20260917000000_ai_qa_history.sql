-- Migration: histórico persistido de perguntas feitas à IA na tela Insights ("Pergunte à
-- IA sobre as conversas") — até agora cada pergunta/resposta só ficava na memória da aba
-- (sumia ao recarregar a página). Uma linha por pergunta, nunca atualizada — é log, não
-- estado atual (ao contrário de ai_conversation_insights).
--
-- Só o service-role escreve aqui (tanto a rota web /api/ai/ask-insights quanto o script
-- local scripts/ask-insights.js, os dois únicos lugares que geram uma resposta pra
-- salvar) — daí não ter policy de INSERT pra `authenticated`. Leitura restrita a
-- admin/gerente, mesmo padrão de ai_conversation_insights: o conteúdo das perguntas e
-- respostas pode tocar em desempenho por vendedor(a).
CREATE TABLE public.ai_qa_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Quem perguntou pela tela — null quando veio do script local (scripts/ask-insights.js
    -- roda com a chave de service role, sem sessão de usuário nenhuma por trás).
    asked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    considered_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_qa_history_org_created ON public.ai_qa_history(organization_id, created_at DESC);

ALTER TABLE public.ai_qa_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/manager leem historico de perguntas da propria organizacao" ON public.ai_qa_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = ai_qa_history.organization_id
              AND om.user_id = auth.uid()
              AND om.role IN ('admin', 'manager')
        )
    );

-- Realtime: o histórico atualiza sozinho na tela se alguém mais perguntar algo enquanto
-- você está com a aba aberta — mesmo padrão de ai_conversation_insights.
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_qa_history;

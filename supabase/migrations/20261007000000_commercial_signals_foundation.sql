-- Migration P0: Commercial Signals Foundation
-- Transforma sinais comerciais extraídos pela IA em dados estruturados, persistentes
-- e consultáveis. Esta é a fundação para Lead Score, Copiloto, Next Best Action, etc.
--
-- NÃO duplica ai_conversation_insights — estende com campos complementares.
-- Reutiliza: organization_members, get_user_org_ids(), is_org_admin(), agent_tasks.
-- Só service_role escreve (via task-worker); leitura restrita a admin/manager.

-- ============================================================================
-- 1. Tabela de sinais comerciais estruturados
-- ============================================================================
-- Cada sinal é uma linha independente: permite múltiplos sinais por conversa,
-- histórico temporal, e agregações granulares (ex: "quantas vezes preço foi objeção").
-- Diferente de ai_conversation_insights.signals (array JSONB opaco), aqui cada sinal
-- tem tipo normalizado, valor estruturado e metadados de contexto.
CREATE TABLE public.commercial_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,

    -- Tipo normalizado do sinal (enum-like via CHECK, não ENUM nativo pra facilitar evolução)
    signal_type TEXT NOT NULL CHECK (signal_type IN (
        'PRODUCT_INTEREST', 'PRICE_ASKED', 'SIZE_SELECTED', 'COLOR_SELECTED',
        'AVAILABILITY_ASKED', 'SHIPPING_ASKED', 'DELIVERY_DEADLINE_ASKED',
        'ADDRESS_PROVIDED', 'DISCOUNT_ASKED',
        'OBJECTION_PRICE', 'OBJECTION_SHIPPING', 'OBJECTION_DEADLINE', 'OBJECTION_PRODUCT',
        'PIX_REQUESTED', 'PIX_KEY_SENT', 'PAYMENT_EVIDENCE_RECEIVED',
        'PAYMENT_CONFIRMED', 'PAYMENT_ON_DELIVERY',
        'MOTOBOY_CONFIRMED', 'PICKUP_CONFIRMED',
        'CANCELLATION_REQUESTED', 'REFUND_REQUESTED',
        'URGENCY_EXPRESSED', 'BUDGET_STATED',
        'COMPETITOR_MENTIONED', 'TESTIMONIAL_SHARED',
        'FOLLOW_UP_SCHEDULED', 'WAITING_CUSTOMER_REPLY',
        'WAITING_ATTENDANT_REPLY', 'ESCALATION_NEEDED'
    )),

    -- Valor estruturado quando aplicável (ex: tamanho "M", cor "azul", preço "89.90")
    -- Null quando o sinal é binário/presença (ex: PIX_KEY_SENT)
    signal_value TEXT,

    -- Metadados contextuais (ex: {"currency": "BRL"} para PRICE_ASKED, {"days": 3} para DELIVERY_DEADLINE_ASKED)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Confiança da extração (0.0-1.0) — permite filtrar sinais incertos em dashboards
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),

    -- Fonte da extração: 'ai_analysis' (task-worker), 'manual' (atendente marcou), 'rule' (regex/heurística)
    source TEXT NOT NULL DEFAULT 'ai_analysis' CHECK (source IN ('ai_analysis', 'manual', 'rule')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices otimizados para os padrões de consulta esperados:
-- 1. Sinais de uma conversa (timeline do copiloto)
CREATE INDEX idx_commercial_signals_conversation ON public.commercial_signals(conversation_id, created_at DESC);
-- 2. Agregação por org + tipo (dashboards, lead score)
CREATE INDEX idx_commercial_signals_org_type ON public.commercial_signals(organization_id, signal_type, created_at DESC);
-- 3. Sinais vinculados a deals (funil, previsão)
CREATE INDEX idx_commercial_signals_deal ON public.commercial_signals(deal_id) WHERE deal_id IS NOT NULL;
-- 4. Busca por mensagem específica (auditoria, correção manual)
CREATE INDEX idx_commercial_signals_message ON public.commercial_signals(message_id) WHERE message_id IS NOT NULL;

-- RLS: mesmo padrão de ai_conversation_insights — admin/manager da própria org leem,
-- service_role escreve (ignora RLS). Attendant NÃO lê sinais comerciais (dado sensível
-- de desempenho/comportamento do cliente, mesma justificativa dos insights).
ALTER TABLE public.commercial_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/manager leem sinais comerciais da própria organização"
    ON public.commercial_signals FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = commercial_signals.organization_id
              AND om.user_id = auth.uid()
              AND om.role IN ('admin', 'manager')
        )
    );

-- Trigger autofill organization_id (mesmo padrão das demais tabelas multi-tenant)
CREATE OR REPLACE FUNCTION public.set_commercial_signals_org_from_conversation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT c.organization_id INTO NEW.organization_id
        FROM public.conversations c WHERE c.id = NEW.conversation_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_commercial_signals_autofill_org
    BEFORE INSERT ON public.commercial_signals
    FOR EACH ROW EXECUTE FUNCTION public.set_commercial_signals_org_from_conversation();

-- Realtime: dashboard de sinais atualiza sem recarregar
ALTER PUBLICATION supabase_realtime ADD TABLE public.commercial_signals;

-- ============================================================================
-- 2. Estende ai_conversation_insights com estado comercial derivado
-- ============================================================================
-- Estes campos são DERIVADOS dos commercial_signals pelo task-worker após persistir
-- os sinais. Não são fonte primária — são cache materializado para consultas rápidas
-- de estado (lead score, status do funil, próxima ação recomendada).
ALTER TABLE public.ai_conversation_insights
    ADD COLUMN IF NOT EXISTS commercial_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS lead_score SMALLINT CHECK (lead_score >= 0 AND lead_score <= 100),
    ADD COLUMN IF NOT EXISTS next_best_action TEXT,
    ADD COLUMN IF NOT EXISTS signals_extracted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ai_conversation_insights.commercial_state IS
    'Estado comercial agregado derivado de commercial_signals. Ex: {"has_price_objection": true, "payment_stage": "pix_sent", "urgency": "high"}. Atualizado pelo task-worker após extração de sinais.';

COMMENT ON COLUMN public.ai_conversation_insights.lead_score IS
    'Score determinístico 0-100 calculado a partir de commercial_signals. Null até primeira extração. Fórmula versionada em src/lib/ai/lead-score.ts.';

COMMENT ON COLUMN public.ai_conversation_insights.next_best_action IS
    'Recomendação textual da próxima ação (ex: "enviar comprovante PIX", "agendar follow-up em 2 dias"). Derivada de commercial_state + regras em src/lib/ai/next-action.ts.';

COMMENT ON COLUMN public.ai_conversation_insights.signals_extracted_at IS
    'Timestamp da última extração de commercial_signals para esta conversa. Diferente de last_analyzed_at (que é da análise de status/outcome).';

-- ============================================================================
-- 3. Grants explícitos (service_role já ignora RLS, mas authenticated precisa)
-- ============================================================================
GRANT SELECT ON public.commercial_signals TO authenticated;
-- INSERT/UPDATE/DELETE apenas via service_role (task-worker), nunca direto pelo client

-- ============================================================================
-- 4. Documentação inline para futuros desenvolvedores
-- ============================================================================
COMMENT ON TABLE public.commercial_signals IS
    'Sinais comerciais estruturados extraídos de conversas. Fonte primária para Lead Score, Copiloto e Analytics. Cada linha é um sinal atômico (ex: PRICE_ASKED, PIX_KEY_SENT). Escrita exclusiva via agent_tasks/task-worker (service_role). Leitura: admin/manager da própria org.';
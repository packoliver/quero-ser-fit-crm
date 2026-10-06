-- ============================================================================
-- Commercial Intelligence: Follow-up States + Loss Reasons (Workstreams 1, 3, 4)
-- ============================================================================
-- Esta migration adiciona colunas estruturadas para suportar a camada de
-- inteligência comercial definida em src/lib/ai/commercial-intelligence.ts.
--
-- Colunas novas em ai_conversation_insights:
--   follow_up_state    : estado determinístico de follow-up
--   loss_reason        : motivo estruturado de perda (quando outcome = 'perdida')
--   loss_controllability: se o motivo é controlável pela equipe
--   temperature        : QUENTE / MORNO / FRIO derivado do lead_score
--   payment_stage      : estágio do funil de pagamento
--
-- Todas as colunas são nullable e preenchidas pelo task-worker na próxima
-- análise. Backfill pode ser feito via /api/ai/backfill-conversations.
-- ============================================================================

-- Follow-up state enum (texto livre para flexibilidade, validado em código)
ALTER TABLE ai_conversation_insights
ADD COLUMN IF NOT EXISTS follow_up_state TEXT,
ADD COLUMN IF NOT EXISTS loss_reason TEXT,
ADD COLUMN IF NOT EXISTS loss_controllability TEXT,
ADD COLUMN IF NOT EXISTS temperature TEXT,
ADD COLUMN IF NOT EXISTS payment_stage TEXT;

-- Índices para filtros frequentes nas páginas /followups, /recuperacao e analytics
CREATE INDEX IF NOT EXISTS idx_insights_follow_up_state
ON ai_conversation_insights(organization_id, follow_up_state)
WHERE follow_up_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_loss_reason
ON ai_conversation_insights(organization_id, loss_reason)
WHERE loss_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_temperature
ON ai_conversation_insights(organization_id, temperature)
WHERE temperature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_payment_stage
ON ai_conversation_insights(organization_id, payment_stage)
WHERE payment_stage IS NOT NULL;

-- Índice composto para recuperação de oportunidades (Workstream 3)
-- Filtra leads quentes/mornos sem tarefa aberta e com sinal positivo
CREATE INDEX IF NOT EXISTS idx_insights_recovery_candidates
ON ai_conversation_insights(organization_id, lead_score DESC, last_analyzed_at DESC)
WHERE lead_score >= 40
AND follow_up_state IN ('FOLLOWUP_NECESSARIO', 'FOLLOWUP_ATRASADO', 'AGUARDANDO_VENDEDORA');

-- Comentários para documentação no schema
COMMENT ON COLUMN ai_conversation_insights.follow_up_state IS
'Estado determinístico de follow-up derivado de sinais comerciais. Valores: AGUARDANDO_CLIENTE, AGUARDANDO_VENDEDORA, FOLLOWUP_NECESSARIO, FOLLOWUP_AGENDADO, FOLLOWUP_ATRASADO, SEM_ACAO_NECESSARIA.';

COMMENT ON COLUMN ai_conversation_insights.loss_reason IS
'Motivo estruturado de perda quando outcome = perdida. Valores: PRICE, SHIPPING, DEADLINE, OUT_OF_STOCK, PRODUCT_INADEQUATE, CLIENT_GAVE_UP, CLIENT_GHOSTED, SELLER_NO_RESPONSE, FOLLOWUP_MISSING, FOLLOWUP_WEAK, OBJECTION_UNHANDLED, COMPETITOR, PAYMENT_METHOD, LOCATION, OPERATIONAL_FAILURE, SERVICE, NO_REAL_PURCHASE_INTENT, UNKNOWN, OTHER.';

COMMENT ON COLUMN ai_conversation_insights.loss_controllability IS
'Se o motivo de perda é controlável pela equipe: CONTROLAVEL ou NAO_CONTROLAVEL.';

COMMENT ON COLUMN ai_conversation_insights.temperature IS
'Temperatura do lead derivada do score: QUENTE (>=70), MORNO (>=40), FRIO (<40).';

COMMENT ON COLUMN ai_conversation_insights.payment_stage IS
'Estágio do funil de pagamento: NONE, PIX_REQUESTED, PIX_KEY_SENT, AWAITING_PAYMENT, EVIDENCE_RECEIVED, CONFIRMED, ON_DELIVERY, MOTOBOY_DISPATCHED, PICKUP_READY.';
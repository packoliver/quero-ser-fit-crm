-- Adiciona suporte a invalidação de sinais comerciais obsoletos
-- Sinais com invalidated_at não devem influenciar score, estado ou relatórios

ALTER TABLE commercial_signals
ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_commercial_signals_valid
ON commercial_signals (conversation_id, signal_type)
WHERE invalidated_at IS NULL;

COMMENT ON COLUMN commercial_signals.invalidated_at IS
'Quando preenchido, sinal é considerado obsoleto e excluído de cálculos de score/estado';
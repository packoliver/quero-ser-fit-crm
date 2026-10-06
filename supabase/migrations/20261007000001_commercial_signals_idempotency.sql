-- Migration P0.1: Idempotência e Reprocessamento Seguro para commercial_signals
-- ============================================================================
-- Resolve bloqueios #2 (idempotência), #13 (reprocessamento/sinais obsoletos)
-- e #15 (concorrência) do Gate de Qualidade P0.
--
-- Estratégia:
-- 1. UNIQUE constraint em (conversation_id, signal_type, source) impede duplicação
--    na inserção direta via INSERT ... ON CONFLICT DO NOTHING.
-- 2. Função upsert_commercial_signals() permite reprocessamento seguro:
--    - Recebe array de sinais extraídos na análise atual
--    - Insere novos sinais (DO NOTHING se já existirem)
--    - Marca sinais antigos NÃO presentes na nova extração como invalidados
--      (soft-delete via coluna invalidated_at) em vez de remover
--    - Retorna contagem de inseridos/invalidados para observabilidade
-- 3. analysis_version registra qual versão do analisador produziu cada sinal,
--    permitindo reprocessamento seletivo quando prompts/regras mudarem.
-- ============================================================================

-- 1. Adiciona colunas de versionamento e invalidação
ALTER TABLE public.commercial_signals
    ADD COLUMN IF NOT EXISTS analysis_version TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.commercial_signals.analysis_version IS
    'Versão do analisador/prompt que extraiu este sinal. Permite reprocessamento seletivo quando regras mudam.';

COMMENT ON COLUMN public.commercial_signals.invalidated_at IS
    'Timestamp de invalidação por reprocessamento. Sinal permanece para auditoria mas é excluído de consultas ativas. Null = ativo.';

-- 2. UNIQUE constraint para idempotência nativa no banco
-- Mesma conversa + mesmo tipo + mesma fonte = um único registro ativo.
-- Nota: não inclui message_id porque a IA pode extrair o mesmo sinal de múltiplas mensagens
-- e queremos deduplicar por conversa, não por mensagem individual.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_signals_conversation_type_source
    ON public.commercial_signals(conversation_id, signal_type, source)
    WHERE invalidated_at IS NULL;

-- Índice parcial para consultas eficientes apenas de sinais ativos
CREATE INDEX IF NOT EXISTS idx_commercial_signals_active
    ON public.commercial_signals(conversation_id, created_at DESC)
    WHERE invalidated_at IS NULL;

-- 3. Função de upsert seguro para reprocessamento
-- Atomicamente insere novos sinais e invalida os que não foram re-extrai­dos.
CREATE OR REPLACE FUNCTION public.upsert_commercial_signals(
    p_conversation_id UUID,
    p_organization_id UUID,
    p_signals JSONB,  -- Array de {signal_type, signal_value?, metadata?, confidence?, source?, analysis_version?}
    p_analysis_version TEXT DEFAULT 'v1'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_signal JSONB;
    v_inserted INT := 0;
    v_invalidated INT := 0;
    v_existing_types TEXT[];
    v_new_types TEXT[] := '{}';
BEGIN
    -- Coleta tipos dos sinais novos
    FOR v_signal IN SELECT * FROM jsonb_array_elements(p_signals) LOOP
        v_new_types := array_append(v_new_types, v_signal->>'signal_type');

        -- Upsert: insere ou ignora se já existe (via UNIQUE index parcial)
        INSERT INTO public.commercial_signals (
            organization_id, conversation_id, signal_type, signal_value,
            metadata, confidence, source, analysis_version
        ) VALUES (
            p_organization_id,
            p_conversation_id,
            v_signal->>'signal_type',
            v_signal->>'signal_value',
            COALESCE(v_signal->'metadata', '{}'::jsonb),
            COALESCE((v_signal->>'confidence')::real, 1.0),
            COALESCE(v_signal->>'source', 'ai_analysis'),
            COALESCE(v_signal->>'analysis_version', p_analysis_version)
        )
        ON CONFLICT (conversation_id, signal_type, source) WHERE invalidated_at IS NULL
        DO UPDATE SET
            signal_value = EXCLUDED.signal_value,
            metadata = EXCLUDED.metadata,
            confidence = EXCLUDED.confidence,
            analysis_version = EXCLUDED.analysis_version
        ;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
    END LOOP;

    -- Invalida sinais antigos que NÃO estão na nova extração (soft-delete)
    -- Apenas sinais da mesma fonte e versão anterior
    UPDATE public.commercial_signals
    SET invalidated_at = NOW()
    WHERE conversation_id = p_conversation_id
      AND source = 'ai_analysis'
      AND invalidated_at IS NULL
      AND signal_type != ALL(v_new_types);
    GET DIAGNOSTICS v_invalidated = ROW_COUNT;

    RETURN jsonb_build_object(
        'inserted_or_updated', v_inserted,
        'invalidated', v_invalidated,
        'total_active', (SELECT COUNT(*) FROM public.commercial_signals
                         WHERE conversation_id = p_conversation_id
                           AND invalidated_at IS NULL)
    );
END;
$$;

COMMENT ON FUNCTION public.upsert_commercial_signals IS
    'Upsert idempotente de sinais comerciais. Insere/atualiza sinais novos e invalida (soft-delete) sinais que não foram re-extrai­dos. Segura para reprocessamento e concorrência.';

-- 4. View de sinais ativos (exclui invalidados) — interface principal para consultas
CREATE OR REPLACE VIEW public.v_active_commercial_signals AS
SELECT *
FROM public.commercial_signals
WHERE invalidated_at IS NULL;

COMMENT ON VIEW public.v_active_commercial_signals IS
    'Sinais comerciais ativos (não invalidados). Use esta view para dashboards, lead score e copiloto. A tabela base contém histórico completo incluindo sinais invalidados por reprocessamento.';

-- 5. Grant da função para service_role (task-worker)
GRANT EXECUTE ON FUNCTION public.upsert_commercial_signals TO service_role;
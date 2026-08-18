-- Migration: enforce `transfer_conversations` and `view_all_conversations` for real.
--
-- Auditoria pré-lançamento de 2026-08-17 encontrou que essas duas permissões existem no
-- toggle de Configurações > Equipe e em src/lib/security/permissions.ts, mas nunca eram
-- checadas de verdade em lugar nenhum (nem RPC, nem RLS) — eram decorativas. Hoje isso
-- não muda nada na prática (só a vendedora + o admin usam o CRM), mas quando a loja
-- contratar mais gente, o admin vai esperar que desmarcar essas caixinhas realmente
-- restrinja alguém, e não restringia.
--
-- IMPORTANTE — preserva o comportamento de hoje: os defaults abaixo (e o default de
-- view_all_conversations em permissions.ts, também ajustado nesta mesma leva de
-- correções) continuam TRUE pra manager/attendant. Ninguém perde acesso a nada só por
-- rodar esta migration — só passa a perder se um admin desmarcar a caixinha pra alguém
-- especificamente em Configurações > Equipe.

-- 1. Helper genérico: espelha a lógica de hasPermission() em
--    src/lib/security/permissions.ts (admin sempre true; override explícito na coluna
--    JSONB `permissions` quando existir; senão o default do papel). Hoje só é usado pelas
--    duas permissões abaixo, cujo default por papel é sempre TRUE — se um dia checar uma
--    permissão com default diferente por papel, ajuste o fallback no fim da função.
CREATE OR REPLACE FUNCTION public.has_permission(org_id UUID, permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_permissions JSONB;
BEGIN
    SELECT role, permissions INTO v_role, v_permissions
    FROM public.organization_members
    WHERE organization_id = org_id AND user_id = (SELECT auth.uid());

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_role = 'admin' THEN
        RETURN TRUE;
    END IF;

    IF v_permissions IS NOT NULL AND jsonb_typeof(v_permissions -> permission_key) = 'boolean' THEN
        RETURN (v_permissions ->> permission_key)::boolean;
    END IF;

    -- Sem override: default do papel. transfer_conversations e view_all_conversations
    -- são TRUE por padrão pra manager E attendant (ver DEFAULT_MANAGER_PERMISSIONS /
    -- DEFAULT_ATTENDANT_PERMISSIONS em src/lib/security/permissions.ts) — daí o TRUE fixo.
    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated, service_role;

-- 2. transfer_conversation_atomic passa a checar transfer_conversations de verdade
--    (antes só checava se o chamador era membro da organização, sem olhar a permissão).
CREATE OR REPLACE FUNCTION public.transfer_conversation_atomic(
    p_conversation_id UUID,
    p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_org_id UUID;
    v_target_valid BOOLEAN;
    v_rows_updated INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    SELECT organization_id INTO v_org_id
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'CONVERSA NÃO ENCONTRADA.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_org_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'PERMISSÃO NEGADA PARA ESTA ORGANIZAÇÃO.';
    END IF;

    IF NOT public.has_permission(v_org_id, 'transfer_conversations') THEN
        RAISE EXCEPTION 'SEM PERMISSÃO PARA TRANSFERIR CONVERSAS.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_org_id AND user_id = p_target_user_id
    ) INTO v_target_valid;

    IF NOT v_target_valid THEN
        RAISE EXCEPTION 'O ATENDENTE DESTINO NÃO PERTENCE À MESMA ORGANIZAÇÃO.';
    END IF;

    UPDATE public.conversations
    SET
        current_assignee_id = p_target_user_id,
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_conversation_id AND organization_id = v_org_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
END;
$$;

-- 3. view_all_conversations: restringe SELECT em conversations/messages quando um admin
--    desmarcar a caixinha pra alguém específico. Política RESTRICTIVE (só combina em AND
--    com a política "Tenant isolation..." já existente, e só afeta SELECT) — não muda
--    nada em INSERT/UPDATE/DELETE nem nas RPCs atômicas (que rodam SECURITY DEFINER e
--    não passam pelas policies do chamador).
--
--    A fila de conversas sem dono (current_assignee_id IS NULL) continua visível mesmo
--    pra quem está restrito — senão a pessoa nunca conseguiria "assumir" uma conversa
--    nova, quebrando a Fila de Espera.
DROP POLICY IF EXISTS "Restrict conversation visibility by view_all_conversations" ON public.conversations;
CREATE POLICY "Restrict conversation visibility by view_all_conversations" ON public.conversations
    AS RESTRICTIVE
    FOR SELECT
    USING (
        public.has_permission(organization_id, 'view_all_conversations')
        OR current_assignee_id = (SELECT auth.uid())
        OR current_assignee_id IS NULL
    );

DROP POLICY IF EXISTS "Restrict message visibility by view_all_conversations" ON public.messages;
CREATE POLICY "Restrict message visibility by view_all_conversations" ON public.messages
    AS RESTRICTIVE
    FOR SELECT
    USING (
        public.has_permission(organization_id, 'view_all_conversations')
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND (c.current_assignee_id = (SELECT auth.uid()) OR c.current_assignee_id IS NULL)
        )
    );

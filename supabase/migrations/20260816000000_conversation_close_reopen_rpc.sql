-- Migration: RPCs to close/reopen a conversation.
--
-- `conversations.status` already supports 'closed' (see phase1_crm_schema.sql), and
-- persist-event.ts already forces status back to 'open' whenever a new inbound message
-- arrives — so a closed conversation naturally reopens the moment the client writes
-- again. What was missing was a way for an attendant to close it in the first place, and
-- to reopen it by hand (e.g. after closing by mistake, or to send one more message
-- without waiting for the client). Follows the exact same shape as
-- assume_conversation_atomic / transfer_conversation_atomic in
-- phase3_atomic_rpc_and_hardening.sql: SECURITY DEFINER, org-membership is the only
-- check enforced here (same as those two) — the finer `close_conversations` permission
-- from src/lib/security/permissions.ts gates the button client-side, matching how
-- assume/transfer already work.

CREATE OR REPLACE FUNCTION public.close_conversation_atomic(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_org_id UUID;
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

    UPDATE public.conversations
    SET status = 'closed', updated_at = NOW()
    WHERE id = p_conversation_id AND organization_id = v_org_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_conversation_atomic(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_org_id UUID;
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

    UPDATE public.conversations
    SET status = 'open', updated_at = NOW()
    WHERE id = p_conversation_id AND organization_id = v_org_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_conversation_atomic(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_conversation_atomic(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.close_conversation_atomic(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_conversation_atomic(UUID) TO authenticated, service_role;

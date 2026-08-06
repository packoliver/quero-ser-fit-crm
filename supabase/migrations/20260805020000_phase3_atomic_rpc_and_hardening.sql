-- Migration: 20260805020000_phase3_atomic_rpc_and_hardening.sql
-- Description: Phase 3 RPCs for atomic conversation assignment, phone normalization, and last-admin safeguards

-- 1. Helper function for phone normalization (digits only)
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
$$;

-- 2. Atomic Conversation Assignment RPC (Prevents Race Conditions)
CREATE OR REPLACE FUNCTION public.assume_conversation_atomic(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_user_org_id UUID;
    v_rows_updated INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    -- Retrieve caller's primary organization
    SELECT organization_id INTO v_user_org_id
    FROM public.organization_members
    WHERE user_id = v_caller_id
    LIMIT 1;

    IF v_user_org_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO PERTENCE A NENHUMA ORGANIZAÇÃO ATIVA.';
    END IF;

    -- Atomic update with row condition
    UPDATE public.conversations
    SET 
        current_assignee_id = v_caller_id,
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_conversation_id
      AND organization_id = v_user_org_id
      AND (current_assignee_id IS NULL OR current_assignee_id = v_caller_id);

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    RETURN v_rows_updated > 0;
END;
$$;

-- 3. Atomic Conversation Transfer RPC
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

    -- Retrieve conversation's organization_id
    SELECT organization_id INTO v_org_id
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'CONVERSA NÃO ENCONTRADA.';
    END IF;

    -- Check if caller is member of this org
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_org_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'PERMISSÃO NEGADA PARA ESTA ORGANIZAÇÃO.';
    END IF;

    -- Check if target user belongs to the same org
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_org_id AND user_id = p_target_user_id
    ) INTO v_target_valid;

    IF NOT v_target_valid THEN
        RAISE EXCEPTION 'O ATENDENTE DESTINO NÃO PERTENCE À MESMA ORGANIZAÇÃO.';
    END IF;

    -- Perform transfer
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

-- 4. Safe Member Role / Status Update with Last-Admin Safeguard
CREATE OR REPLACE FUNCTION public.update_member_role_safe(
    p_org_id UUID,
    p_target_user_id UUID,
    p_new_role public.user_role
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_is_caller_admin BOOLEAN;
    v_current_target_role public.user_role;
    v_active_admins_count INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    -- Check if caller is admin of p_org_id
    SELECT public.is_org_admin(p_org_id) INTO v_is_caller_admin;
    IF NOT v_is_caller_admin THEN
        RAISE EXCEPTION 'SOMENTE ADMINISTRADORES PODEM ALTERAR AS PERMISSÕES DA EQUIPE.';
    END IF;

    -- Retrieve target user's current role in p_org_id
    SELECT role INTO v_current_target_role
    FROM public.organization_members
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    IF v_current_target_role IS NULL THEN
        RAISE EXCEPTION 'MEMBRO NÃO ENCONTRADO NAF ORGANIZAÇÃO ESPECIFICADA.';
    END IF;

    -- If target user is an admin and is being demoted to attendant, verify remaining admin count
    IF v_current_target_role = 'admin' AND p_new_role = 'attendant' THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.organization_members
        WHERE organization_id = p_org_id AND role = 'admin';

        IF v_active_admins_count <= 1 THEN
            RAISE EXCEPTION 'NÃO É PERMITIDO REMOVER OU REBAIXAR O ÚLTIMO ADMINISTRADOR ATIVO DA ORGANIZAÇÃO.';
        END IF;
    END IF;

    -- Update member role
    UPDATE public.organization_members
    SET role = p_new_role
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    RETURN TRUE;
END;
$$;

-- Revoke execute from PUBLIC and anon, grant only to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assume_conversation_atomic(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_conversation_atomic(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_member_role_safe(UUID, UUID, public.user_role) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assume_conversation_atomic(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_conversation_atomic(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_member_role_safe(UUID, UUID, public.user_role) TO authenticated, service_role;

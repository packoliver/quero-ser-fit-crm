-- Migration: log role changes into audit_logs from inside update_member_role_safe
-- itself (SECURITY DEFINER, already resolves the caller/permissions), so the log entry
-- can't be bypassed by calling the RPC directly instead of going through some UI layer
-- that happened to add logging on its own.

CREATE OR REPLACE FUNCTION public.update_member_role_safe(
    p_org_id UUID,
    p_target_user_id UUID,
    p_new_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_is_caller_admin BOOLEAN;
    v_current_target_role TEXT;
    v_active_admins_count INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    SELECT public.is_org_admin(p_org_id) INTO v_is_caller_admin;
    IF NOT v_is_caller_admin THEN
        RAISE EXCEPTION 'SOMENTE ADMINISTRADORES PODEM ALTERAR AS PERMISSÕES DA EQUIPE.';
    END IF;

    SELECT role INTO v_current_target_role
    FROM public.organization_members
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    IF v_current_target_role IS NULL THEN
        RAISE EXCEPTION 'MEMBRO NÃO ENCONTRADO NAF ORGANIZAÇÃO ESPECIFICADA.';
    END IF;

    IF v_current_target_role = 'admin' AND p_new_role = 'attendant' THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.organization_members
        WHERE organization_id = p_org_id AND role = 'admin';

        IF v_active_admins_count <= 1 THEN
            RAISE EXCEPTION 'NÃO É PERMITIDO REMOVER OU REBAIXAR O ÚLTIMO ADMINISTRADOR ATIVO DA ORGANIZAÇÃO.';
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (
        p_org_id,
        v_caller_id,
        'member_role_changed',
        'organization_member',
        p_target_user_id,
        jsonb_build_object('from_role', v_current_target_role, 'to_role', p_new_role)
    );

    RETURN TRUE;
END;
$$;

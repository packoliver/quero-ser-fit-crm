-- Migration: safe team member removal.
--
-- Found during a pre-launch audit: the real (Supabase) mode of Equipe had NO way at all
-- to remove or deactivate a team member — only the demo/localStorage mode had that
-- button wired up. An admin whose employee left the store had no way to revoke their
-- access from the UI. RLS already lets an org admin DELETE freely from
-- organization_members ("Admins can manage organization members"), but a raw client-side
-- DELETE has no protection against an admin accidentally removing the last active admin
-- of the organization (locking everyone out) — update_member_role_safe already guards
-- that same scenario for role *changes*, this mirrors it for outright *removal*.
CREATE OR REPLACE FUNCTION public.remove_member_safe(
    p_org_id UUID,
    p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_is_caller_admin BOOLEAN;
    v_target_role TEXT;
    v_active_admins_count INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    SELECT public.is_org_admin(p_org_id) INTO v_is_caller_admin;
    IF NOT v_is_caller_admin THEN
        RAISE EXCEPTION 'SOMENTE ADMINISTRADORES PODEM REMOVER MEMBROS DA EQUIPE.';
    END IF;

    SELECT role INTO v_target_role
    FROM public.organization_members
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'MEMBRO NÃO ENCONTRADO NA ORGANIZAÇÃO ESPECIFICADA.';
    END IF;

    IF v_target_role = 'admin' THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.organization_members
        WHERE organization_id = p_org_id AND role = 'admin';

        IF v_active_admins_count <= 1 THEN
            RAISE EXCEPTION 'NÃO É PERMITIDO REMOVER O ÚLTIMO ADMINISTRADOR ATIVO DA ORGANIZAÇÃO.';
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (
        p_org_id,
        v_caller_id,
        'member_removed',
        'organization_member',
        p_target_user_id,
        jsonb_build_object('removed_role', v_target_role)
    );

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_member_safe(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_member_safe(UUID, UUID) TO authenticated, service_role;

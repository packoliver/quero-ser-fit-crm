-- Migration: Fix RLS search_path and conversation_list_view performance
-- Date: 2026-10-03
-- Issue: "Indicadores de espera indisponíveis" + slow conversation loading
-- Root cause: get_user_org_ids() and has_permission() have search_path='' (empty),
--   causing silent failures when referencing public.organization_members.
--   Also, conversation_list_view scans ALL conversations before RLS filters them,
--   causing timeout with 859+ conversations.
-- Fix: Re-create functions with explicit search_path = 'public',
--   and add organization filter directly in the view WHERE clause.

-- Step 1: Fix get_user_org_ids() - add explicit search_path
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = (SELECT auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.get_user_org_ids() TO authenticated;

-- Step 2: Fix has_permission() - add explicit search_path
CREATE OR REPLACE FUNCTION public.has_permission(
  org_id uuid,
  permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_role TEXT;
  v_permissions JSONB;
  v_manager_defaults CONSTANT JSONB := '{
    "view_all_conversations": true, "assume_conversations": true, "transfer_conversations": true,
    "close_conversations": true, "delete_messages": true, "create_clients": true, "edit_clients": true,
    "delete_clients": true, "export_clients": true, "view_client_notes": true, "create_tasks": true,
    "edit_tasks": true, "create_deals": true, "edit_deals": true, "assign_tasks_to_others": true,
    "delete_tasks": true, "view_reports": true, "export_reports": true, "manage_attendants": true,
    "manage_integrations": false, "manage_pipeline_stages": true
  }'::jsonb;
  v_attendant_defaults CONSTANT JSONB := '{
    "view_all_conversations": true, "assume_conversations": true, "transfer_conversations": true,
    "close_conversations": true, "delete_messages": false, "create_clients": true, "edit_clients": true,
    "delete_clients": false, "export_clients": false, "view_client_notes": true, "create_tasks": true,
    "edit_tasks": true, "create_deals": true, "edit_deals": true, "assign_tasks_to_others": false,
    "delete_tasks": false, "view_reports": true, "export_reports": false, "manage_attendants": false,
    "manage_integrations": false, "manage_pipeline_stages": false
  }'::jsonb;
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

  -- Override explícito salvo pra essa pessoa
  IF v_permissions IS NOT NULL AND jsonb_typeof(v_permissions -> permission_key) = 'boolean' THEN
    RETURN (v_permissions ->> permission_key)::boolean;
  END IF;

  -- Sem override: cai no padrão do papel
  IF v_role = 'manager' THEN
    RETURN COALESCE((v_manager_defaults ->> permission_key)::boolean, FALSE);
  END IF;

  RETURN COALESCE((v_attendant_defaults ->> permission_key)::boolean, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;

-- Step 3: Recreate conversation_list_view with organization filter in WHERE clause
-- This prevents scanning all 859+ conversations before RLS applies
DROP VIEW IF EXISTS public.conversation_list_view CASCADE;

CREATE VIEW public.conversation_list_view WITH (security_invoker = true) AS
SELECT
  c.id,
  c.organization_id,
  c.contact_id,
  c.status,
  c.channel_type,
  c.current_assignee_id,
  c.last_message_at,
  c.csat_score,
  ct.name AS contact_name,
  ct.phone AS contact_phone,
  ct.is_group AS contact_is_group,
  ct.avatar_url AS contact_avatar_url,
  pr.full_name AS assignee_name,
  lm.content AS last_message_content,
  lm.media_type AS last_message_media_type,
  lm.sender_type AS last_message_sender_type,
  lm.created_at AS last_message_created_at
FROM public.conversations c
LEFT JOIN public.contacts ct ON ct.id = c.contact_id
LEFT JOIN public.profiles pr ON pr.id = c.current_assignee_id
LEFT JOIN LATERAL (
  SELECT m.content, m.media_type, m.sender_type, m.created_at
  FROM public.messages m
  WHERE m.conversation_id = c.id
  ORDER BY m.created_at DESC
  LIMIT 1
) lm ON true
WHERE c.organization_id IN (
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = (SELECT auth.uid())
);

GRANT SELECT ON public.conversation_list_view TO authenticated;

-- Step 4: Verify the fix worked
-- Run this separately after applying:
-- SELECT count(*) FROM public.conversation_list_view;
-- Should return > 0 rows for admin user comercial@queroserfit.com
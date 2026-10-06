-- The 20261003 migration made get_user_org_ids SECURITY INVOKER. The SELECT
-- policy on organization_members calls that same function, recursively applying
-- itself until queries fail with SQLSTATE 54001 or a statement timeout.
-- Only the caller's membership lookup needs to bypass that policy; conversation
-- queries and permission checks must continue to run with the caller's RLS.
CREATE SCHEMA IF NOT EXISTS crm_private;
REVOKE ALL ON SCHEMA crm_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA crm_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION crm_private.get_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = (SELECT auth.uid());
$$;

REVOKE ALL ON FUNCTION crm_private.get_user_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_private.get_user_org_ids() TO authenticated, service_role;

-- Keep the existing public API and policy dependencies, with no privileged
-- function exposed through PostgREST. No caller-supplied user ID is accepted.
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT crm_private.get_user_org_ids();
$$;

REVOKE ALL ON FUNCTION public.get_user_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_ids() TO authenticated, service_role;

-- The deployed unread RPC had drifted to SECURITY DEFINER without a tenant
-- filter. Restore the original invoker behavior so unread counts obey both
-- tenant isolation and view_all_conversations, just like the inbox itself.
CREATE OR REPLACE FUNCTION public.get_unread_counts()
RETURNS TABLE (conversation_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT m.conversation_id, count(*)::bigint
  FROM public.messages m
  LEFT JOIN public.conversation_reads r
    ON r.conversation_id = m.conversation_id
   AND r.user_id = (SELECT auth.uid())
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND m.sender_type = 'contact'
    AND m.organization_id IN (SELECT public.get_user_org_ids())
    AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
  GROUP BY m.conversation_id;
$$;

REVOKE ALL ON FUNCTION public.get_unread_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_counts() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_org_ids() IS
  'Caller organizations via a private, JWT-scoped membership lookup that avoids recursive membership RLS.';
COMMENT ON FUNCTION public.get_conversation_list_secure() IS
  'Conversation list under caller RLS. auth.uid() reads request JWT claims independently of SECURITY INVOKER/DEFINER.';

NOTIFY pgrst, 'reload schema';

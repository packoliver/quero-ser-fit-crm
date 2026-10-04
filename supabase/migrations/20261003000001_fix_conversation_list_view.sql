-- Migration: Fix conversation_list_view performance and RLS blocking
-- Date: 2026-10-03
-- Issue: "Indicadores de espera indisponíveis" + slow conversation loading for admin user
-- Root cause: conversation_list_view scans ALL 859+ conversations before RLS filters by org,
-- causing timeout or empty result. The RLS functions were already fixed in previous migration.
-- This migration adds organization filter directly in the view WHERE clause.
-- IMPORTANT: Apply this AFTER running 20261003000000_fix_rls_search_path_and_view_performance.sql

-- Step 1: Drop existing view (CASCADE ensures dependent objects are handled)
DROP VIEW IF EXISTS public.conversation_list_view CASCADE;

-- Step 2: Recreate view with organization filter in WHERE clause
-- This ensures only conversations belonging to the authenticated user's organization
-- are processed, preventing full table scan of 859+ conversations
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

-- Step 3: Grant SELECT permission to authenticated users
GRANT SELECT ON public.conversation_list_view TO authenticated;

-- Step 4: Verify the fix worked
-- After applying this migration, run this query in Supabase SQL Editor:
-- SELECT count(*) FROM public.conversation_list_view;
-- Expected: Should return > 0 rows for admin user comercial@queroserfit.com
-- The "Indicadores de espera indisponíveis" error should disappear immediately after refresh
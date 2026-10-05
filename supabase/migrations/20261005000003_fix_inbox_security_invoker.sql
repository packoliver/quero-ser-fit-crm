-- Migration: Fix Inbox empty list — SECURITY DEFINER → INVOKER
-- Date: 2026-10-05
-- Problem: get_conversation_list_secure was SECURITY DEFINER + (SELECT auth.uid()),
-- which returns NULL inside definer context, causing the org filter to silently
-- exclude all rows. Inbox showed "Indicadores de espera indisponíveis" and no conversations.
-- Fix: Change to SECURITY INVOKER so auth.uid() resolves from the caller's JWT session.
-- Validated: RPC returns correct data with simulated JWT context; isolation preserved.

CREATE OR REPLACE FUNCTION public.get_conversation_list_secure()
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    contact_id UUID,
    status TEXT,
    channel_type TEXT,
    current_assignee_id UUID,
    last_message_at TIMESTAMPTZ,
    csat_score INTEGER,
    contact_name TEXT,
    contact_phone TEXT,
    contact_is_group BOOLEAN,
    contact_avatar_url TEXT,
    assignee_name TEXT,
    last_message_content TEXT,
    last_message_media_type TEXT,
    last_message_sender_type TEXT,
    last_message_created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
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
FROM conversations c
LEFT JOIN contacts ct ON ct.id = c.contact_id
LEFT JOIN profiles pr ON pr.id = c.current_assignee_id
LEFT JOIN LATERAL (
    SELECT m.content, m.media_type, m.sender_type, m.created_at
    FROM messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
) lm ON true
WHERE c.organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
)
ORDER BY c.last_message_at DESC;
$$;

COMMENT ON FUNCTION public.get_conversation_list_secure IS
'Returns conversation list for the authenticated user organization. SECURITY INVOKER ensures auth.uid() resolves from caller JWT, not definer context.';
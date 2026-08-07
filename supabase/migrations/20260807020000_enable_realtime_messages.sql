-- Migration: enable Supabase Realtime (Postgres Changes) for messages and conversations,
-- so the Inbox updates live when a new message arrives via webhook or another attendant
-- sends/assumes/transfers something — no manual refresh needed.
--
-- Realtime respects each table's RLS policies for authenticated clients, so this is safe
-- to broadcast broadly: a user only ever receives change events for rows their existing
-- "Tenant isolation for messages/conversations" policies already let them SELECT.
--
-- Wrapped in a guard because ALTER PUBLICATION ... ADD TABLE errors if the table is
-- already a publication member (e.g. re-running this on a project where Realtime was
-- enabled by hand in the dashboard).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;

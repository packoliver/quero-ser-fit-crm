-- Migration: WhatsApp group support.
--
-- `contacts.is_group` flags a contact record that actually represents a WhatsApp group
-- (not an individual) — the Inbox uses this to show a distinct icon/badge. Groups are
-- only reachable via uazapi (Meta's Cloud API doesn't deliver group messages to
-- webhooks at all, so whatsapp_meta/instagram_meta contacts are never groups).
--
-- This ships alongside a code fix (persist-event.ts) that stops scoping conversation
-- lookup by integration_connection_id — previously, recreating a WhatsApp connection
-- (a free-tier uazapi instance expiring and getting re-added, e.g.) silently started a
-- brand new conversation for every existing contact instead of continuing their
-- history, because the match required an exact connection id match too.

ALTER TABLE public.contacts
    ADD COLUMN is_group BOOLEAN NOT NULL DEFAULT false;

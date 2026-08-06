-- Migration: link each conversation to the specific integration_connections row
-- (WhatsApp number / Instagram page) it came in through.
--
-- Now that an organization can have several WhatsApp numbers and/or Instagram pages,
-- outbound replies need to know WHICH number/page's credentials to send through. This
-- column is set once, when the webhook handler creates the conversation for an inbound
-- message, and read back whenever the app sends a reply on that conversation.

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS integration_connection_id UUID
        REFERENCES public.integration_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_integration_connection
    ON public.conversations(integration_connection_id);

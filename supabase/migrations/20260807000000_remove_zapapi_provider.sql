-- Migration: fully remove the zap-api.tech ('whatsapp_zapapi' / connection_method
-- 'zapapi') integration. The app code for it has been deleted; a new WhatsApp
-- connector will be added later. Any existing connections using this provider can no
-- longer function (the code that talked to zap-api.tech is gone), so they're removed
-- here too. conversations.integration_connection_id uses ON DELETE SET NULL, so
-- existing conversations/messages are preserved — they just lose the connection link
-- until re-attached to a new connection.

DELETE FROM public.integration_connections
WHERE connection_method = 'zapapi' OR provider = 'whatsapp_zapapi';

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_connection_method_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_connection_method_check
    CHECK (connection_method IN ('cloud_api'));

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_provider_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_provider_check
    CHECK (provider IN ('whatsapp_meta', 'instagram_meta'));

-- Migration: replace the z-api.io provider ('whatsapp_zapi' / connection_method 'zapi')
-- with zap-api.tech ('whatsapp_zapapi' / connection_method 'zapapi'). No rows exist with
-- the old values (never shipped past testing), so this is a safe, non-destructive rename.
--
-- Why the switch: zap-api.tech signs its webhooks with real HMAC-SHA256
-- (x-zapapi-signature-256 header), unlike z-api.io which had no signing at all and
-- required a shared secret in the callback URL as a weaker substitute.

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_connection_method_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_connection_method_check
    CHECK (connection_method IN ('cloud_api', 'zapapi'));

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_provider_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_provider_check
    CHECK (provider IN ('whatsapp_meta', 'whatsapp_zapapi', 'instagram_meta'));

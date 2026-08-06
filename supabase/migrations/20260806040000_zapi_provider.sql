-- Migration: replace the never-used 'qr_code' (self-hosted Baileys) connection method
-- with 'zapi' — WhatsApp connected via the hosted third-party service z-api.io instead
-- of a self-hosted always-on worker. No rows exist with connection_method='qr_code' yet
-- (it was never shipped past a placeholder), so this is a safe, non-destructive rename
-- of the allowed values.

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_connection_method_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_connection_method_check
    CHECK (connection_method IN ('cloud_api', 'zapi'));

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_provider_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_provider_check
    CHECK (provider IN ('whatsapp_meta', 'whatsapp_zapi', 'instagram_meta'));

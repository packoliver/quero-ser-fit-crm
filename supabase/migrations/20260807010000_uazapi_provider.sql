-- Migration: add the uazapi (uazapiGO) WhatsApp connector.
--
-- Unlike Meta's Cloud API (one fixed API host) or zap-api.tech (one fixed API host),
-- each uazapi account has its own subdomain (e.g. https://minhaempresa.uazapi.com), so
-- the base URL has to be stored per-connection — hence `api_base_url`.
--
-- uazapi also doesn't sign its webhook calls with HMAC (no secret field in their
-- webhook config at all), so authenticity is guaranteed instead by a random secret
-- embedded directly in the webhook URL's path (/api/webhooks/uazapi/[secret]) — hence
-- `webhook_secret`, generated once per connection and reused across re-verifications.

ALTER TABLE public.integration_connections
    ADD COLUMN api_base_url TEXT;

ALTER TABLE public.integration_connections
    ADD COLUMN webhook_secret TEXT;

CREATE UNIQUE INDEX integration_connections_webhook_secret_key
    ON public.integration_connections (webhook_secret)
    WHERE webhook_secret IS NOT NULL;

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_connection_method_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_connection_method_check
    CHECK (connection_method IN ('cloud_api', 'uazapi'));

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_provider_check;

ALTER TABLE public.integration_connections
    ADD CONSTRAINT integration_connections_provider_check
    CHECK (provider IN ('whatsapp_meta', 'instagram_meta', 'whatsapp_uazapi'));

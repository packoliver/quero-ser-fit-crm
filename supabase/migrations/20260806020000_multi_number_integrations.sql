-- Migration: allow multiple WhatsApp/Instagram connections per organization, and
-- distinguish the official Cloud API method from an unofficial QR Code (WhatsApp Web)
-- method per connection.
--
-- integration_connections previously had UNIQUE(organization_id, provider), which caps
-- each organization at exactly one WhatsApp connection and one Instagram connection
-- total. That blocks registering more than one WhatsApp number.

ALTER TABLE public.integration_connections
    DROP CONSTRAINT IF EXISTS integration_connections_organization_id_provider_key;

-- Human-friendly name the admin assigns to this connection (e.g. "Loja Centro").
ALTER TABLE public.integration_connections
    ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'Conexão Principal';

-- How this specific connection talks to Meta.
--   cloud_api  -> official WhatsApp/Instagram Cloud API (access token, no QR code)
--   qr_code    -> unofficial WhatsApp Web session (Baileys-style), requires a separate
--                 always-on worker process; NOT compatible with serverless hosting.
ALTER TABLE public.integration_connections
    ADD COLUMN IF NOT EXISTS connection_method TEXT NOT NULL DEFAULT 'cloud_api'
    CHECK (connection_method IN ('cloud_api', 'qr_code'));

-- The stable identifier Meta sends on each inbound webhook event so we know which
-- connection (and therefore which organization) a message belongs to:
--   whatsapp_meta + cloud_api -> phone_number_id from the WhatsApp Business Account
--   whatsapp_meta + qr_code   -> the WhatsApp number itself (no phone_number_id exists)
--   instagram_meta            -> the connected Instagram/Facebook Page ID
ALTER TABLE public.integration_connections
    ADD COLUMN IF NOT EXISTS external_identifier TEXT;

-- Prevent registering the exact same external number/page twice for the same org,
-- while allowing many different ones.
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_org_provider_identifier_key
    ON public.integration_connections (organization_id, provider, external_identifier)
    WHERE external_identifier IS NOT NULL;

COMMENT ON COLUMN public.integration_connections.connection_method IS
    'cloud_api = official Meta Cloud API (token-based, serverless-friendly). qr_code = unofficial WhatsApp Web session, requires a dedicated always-on worker process outside this Next.js app.';
COMMENT ON COLUMN public.integration_connections.external_identifier IS
    'Routing key from inbound webhook payloads (phone_number_id for WhatsApp Cloud API, the WhatsApp number for qr_code, the Page ID for Instagram) used to map an incoming message to the right organization/connection.';

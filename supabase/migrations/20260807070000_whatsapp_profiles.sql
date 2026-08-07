-- Migration: cache of individual WhatsApp profile photos for group participants.
--
-- The uazapi `messages` webhook event (schema `Message`) gives us `senderName` for
-- whoever sent a group message, but NOT a photo — that only comes back from a separate
-- `POST /chat/details` call per number (schema `Chat`, fields `image`/`imagePreview`).
-- Deliberately NOT stored on `contacts`: a group can have dozens of participants who
-- are someone else's WhatsApp contact, not a lead of this business — turning every one
-- of them into a `contacts` row would flood Clientes/Funil/Follow-up with people the
-- organization has no actual relationship with. This table exists purely so the Inbox
-- can render "who's who" (name + small avatar) next to each message bubble inside a
-- group conversation.
CREATE TABLE public.whatsapp_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, external_id)
);

CREATE INDEX idx_whatsapp_profiles_org ON public.whatsapp_profiles(organization_id);

ALTER TABLE public.whatsapp_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for whatsapp_profiles" ON public.whatsapp_profiles
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

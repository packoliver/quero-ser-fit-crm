-- MASTER INSTALL SCRIPT FOR QUERO SER FIT CRM

-- Step 0: Clean Reset (completely cleans the public schema back to 100% blank)
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom Types
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('admin', 'attendant');
    END IF;
END $$;

-- 1. Organizations
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Profiles (linked to auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    avatar_url TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Organization Members
CREATE TABLE public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'attendant')),
    permissions JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- 4. Contacts
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'blocked')),
    notes TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Contact Channels
CREATE TABLE public.contact_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('whatsapp', 'instagram')),
    external_id TEXT NOT NULL,
    identifier TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, channel_type, external_id)
);

-- 6. Conversations
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('whatsapp', 'instagram')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'closed', 'archived')),
    current_assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Conversation Assignments
CREATE TABLE public.conversation_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    assigned_to_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_by_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred', 'released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Messages
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('contact', 'user', 'system')),
    sender_id UUID,
    content TEXT NOT NULL,
    media_url TEXT,
    media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'document', 'sticker')),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    external_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Tags
CREATE TABLE public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#10B981',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- 10. Contact Tags
CREATE TABLE public.contact_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(contact_id, tag_id)
);

-- 11. Internal Notes
CREATE TABLE public.internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Tasks
CREATE TABLE public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'baixa')),
    assigned_to_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Audit Logs
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Integration Connections
-- Multiple connections per (organization, provider) are allowed on purpose — an
-- organization can register several WhatsApp numbers and/or Instagram pages.
-- `connection_method` distinguishes between connector types: the official Cloud API
-- (fixed API host, token-based) vs uazapi (unofficial WhatsApp Web session, per-account
-- subdomain — see `api_base_url`). `external_identifier` is the routing key from
-- inbound webhook payloads (phone_number_id / Page ID / uazapi instance id) used to
-- map an incoming message to the right connection. `webhook_secret` is only used by
-- providers that can't sign their webhooks with HMAC (uazapi) — the secret is embedded
-- in the webhook URL's path instead of a signature header.
CREATE TABLE public.integration_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('whatsapp_meta', 'instagram_meta', 'whatsapp_uazapi')),
    label TEXT NOT NULL DEFAULT 'Conexão Principal',
    connection_method TEXT NOT NULL DEFAULT 'cloud_api' CHECK (connection_method IN ('cloud_api', 'uazapi')),
    external_identifier TEXT,
    api_base_url TEXT,
    webhook_secret TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'error')),
    encrypted_credentials TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX integration_connections_org_provider_identifier_key
    ON public.integration_connections (organization_id, provider, external_identifier)
    WHERE external_identifier IS NOT NULL;

CREATE UNIQUE INDEX integration_connections_webhook_secret_key
    ON public.integration_connections (webhook_secret)
    WHERE webhook_secret IS NOT NULL;

-- Links a conversation back to the specific WhatsApp number / Instagram page it came in
-- through, so outbound replies know which connection's credentials to send with.
ALTER TABLE public.conversations
    ADD COLUMN integration_connection_id UUID REFERENCES public.integration_connections(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_integration_connection ON public.conversations(integration_connection_id);

-- 15. Webhook Events (Idempotent)
CREATE TABLE public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    external_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, external_event_id)
);

-- Helper Functions

-- Auto-fills organization_id on INSERT when the client didn't supply it (every real
-- CRUD page inserts directly from the browser without an explicit org_id — this derives
-- it from the caller's own membership so those inserts don't fail NOT NULL). No-ops when
-- an org_id was already provided, e.g. every server-side admin-client insert.
CREATE OR REPLACE FUNCTION public.set_organization_id_from_caller()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO v_org_id
        FROM public.organization_members
        WHERE user_id = auth.uid()
        LIMIT 1;

        IF v_org_id IS NULL THEN
            RAISE EXCEPTION 'USUÁRIO NÃO POSSUI ORGANIZAÇÃO ASSOCIADA — não é possível determinar organization_id automaticamente.';
        END IF;

        NEW.organization_id := v_org_id;
    END IF;
    RETURN NEW;
END;
$$;

-- internal_notes needs both organization_id (derived from its conversation) and
-- author_id (the writing user) auto-filled — the Inbox "Notas Internas" insert supplies
-- neither.
CREATE OR REPLACE FUNCTION public.set_internal_note_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.author_id IS NULL THEN
        NEW.author_id := auth.uid();
    END IF;

    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.conversations
        WHERE id = NEW.conversation_id;

        IF NEW.organization_id IS NULL THEN
            RAISE EXCEPTION 'CONVERSA NÃO ENCONTRADA — não é possível determinar organization_id da nota interna.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
    SELECT organization_id 
    FROM public.organization_members 
    WHERE user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.organization_members 
        WHERE organization_id = org_id 
          AND user_id = (SELECT auth.uid()) 
          AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
$$;

-- Indexes
CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(organization_id);
CREATE INDEX idx_contacts_org ON public.contacts(organization_id);
CREATE INDEX idx_conversations_org ON public.conversations(organization_id);
CREATE INDEX idx_conversations_contact ON public.conversations(contact_id);
CREATE INDEX idx_conversations_assignee ON public.conversations(current_assignee_id);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_org ON public.messages(organization_id);
CREATE INDEX idx_tasks_org ON public.tasks(organization_id);
CREATE INDEX idx_tasks_assignee ON public.tasks(assigned_to_id);
CREATE INDEX idx_audit_logs_org ON public.audit_logs(organization_id);
CREATE INDEX idx_webhook_events_provider_extid ON public.webhook_events(provider, external_event_id);
CREATE UNIQUE INDEX idx_contact_channels_global_extid ON public.contact_channels (channel_type, external_id);
CREATE UNIQUE INDEX idx_contacts_org_normalized_phone ON public.contacts (organization_id, public.normalize_phone(phone)) WHERE phone IS NOT NULL AND public.normalize_phone(phone) <> '';

-- RPC Functions
CREATE OR REPLACE FUNCTION public.assume_conversation_atomic(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_user_org_id UUID;
    v_rows_updated INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    SELECT organization_id INTO v_user_org_id
    FROM public.organization_members
    WHERE user_id = v_caller_id
    LIMIT 1;

    IF v_user_org_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO PERTENCE A NENHUMA ORGANIZAÇÃO ATIVA.';
    END IF;

    UPDATE public.conversations
    SET 
        current_assignee_id = v_caller_id,
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_conversation_id
      AND organization_id = v_user_org_id
      AND (current_assignee_id IS NULL OR current_assignee_id = v_caller_id);

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_conversation_atomic(
    p_conversation_id UUID,
    p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_org_id UUID;
    v_target_valid BOOLEAN;
    v_rows_updated INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    SELECT organization_id INTO v_org_id
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'CONVERSA NÃO ENCONTRADA.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_org_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'PERMISSÃO NEGADA PARA ESTA ORGANIZAÇÃO.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_org_id AND user_id = p_target_user_id
    ) INTO v_target_valid;

    IF NOT v_target_valid THEN
        RAISE EXCEPTION 'O ATENDENTE DESTINO NÃO PERTENCE À MESMA ORGANIZAÇÃO.';
    END IF;

    UPDATE public.conversations
    SET 
        current_assignee_id = p_target_user_id,
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_conversation_id AND organization_id = v_org_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_member_role_safe(
    p_org_id UUID,
    p_target_user_id UUID,
    p_new_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_is_caller_admin BOOLEAN;
    v_current_target_role TEXT;
    v_active_admins_count INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'USUÁRIO NÃO AUTENTICADO.';
    END IF;

    SELECT public.is_org_admin(p_org_id) INTO v_is_caller_admin;
    IF NOT v_is_caller_admin THEN
        RAISE EXCEPTION 'SOMENTE ADMINISTRADORES PODEM ALTERAR AS PERMISSÕES DA EQUIPE.';
    END IF;

    SELECT role INTO v_current_target_role
    FROM public.organization_members
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    IF v_current_target_role IS NULL THEN
        RAISE EXCEPTION 'MEMBRO NÃO ENCONTRADO NAF ORGANIZAÇÃO ESPECIFICADA.';
    END IF;

    IF v_current_target_role = 'admin' AND p_new_role = 'attendant' THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.organization_members
        WHERE organization_id = p_org_id AND role = 'admin';

        IF v_active_admins_count <= 1 THEN
            RAISE EXCEPTION 'NÃO É PERMITIDO REMOVER OU REBAIXAR O ÚLTIMO ADMINISTRADOR ATIVO DA ORGANIZAÇÃO.';
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role
    WHERE organization_id = p_org_id AND user_id = p_target_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (
        p_org_id,
        v_caller_id,
        'member_role_changed',
        'organization_member',
        p_target_user_id,
        jsonb_build_object('from_role', v_current_target_role, 'to_role', p_new_role)
    );

    RETURN TRUE;
END;
$$;

-- Auto-fill triggers (organization_id / author_id) for tables real pages insert into
-- directly from the browser.
CREATE TRIGGER trg_autofill_org_contacts
    BEFORE INSERT ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

CREATE TRIGGER trg_autofill_org_tasks
    BEFORE INSERT ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

CREATE TRIGGER trg_autofill_org_contact_channels
    BEFORE INSERT ON public.contact_channels
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

CREATE TRIGGER trg_autofill_org_conversations
    BEFORE INSERT ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

CREATE TRIGGER trg_autofill_org_messages
    BEFORE INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

CREATE TRIGGER trg_autofill_internal_notes
    BEFORE INSERT ON public.internal_notes
    FOR EACH ROW EXECUTE FUNCTION public.set_internal_note_defaults();

-- Enable Row Level Security
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own organizations" ON public.organizations
    FOR SELECT USING (id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Admins can update their organization" ON public.organizations
    FOR UPDATE USING (public.is_org_admin(id));

CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Members viewable within organization" ON public.organization_members
    FOR SELECT USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Admins can manage organization members" ON public.organization_members
    FOR ALL USING (public.is_org_admin(organization_id));

CREATE POLICY "Tenant isolation for contacts" ON public.contacts
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for contact_channels" ON public.contact_channels
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for conversations" ON public.conversations
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for conversation_assignments" ON public.conversation_assignments
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for messages" ON public.messages
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for tags" ON public.tags
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for contact_tags" ON public.contact_tags
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for internal_notes" ON public.internal_notes
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Tenant isolation for tasks" ON public.tasks
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Admins can select audit_logs" ON public.audit_logs
    FOR SELECT USING (public.is_org_admin(organization_id));

CREATE POLICY "Admins can view integration connections" ON public.integration_connections
    FOR SELECT USING (organization_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Admins can modify integration connections" ON public.integration_connections
    FOR ALL USING (public.is_org_admin(organization_id));

CREATE POLICY "Service role or authenticated users can manage webhook events" ON public.webhook_events
    FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));

-- Permissions
-- Step 0 dropped and recreated the `public` schema, which wipes the default table
-- privileges Supabase normally pre-configures for anon/authenticated/service_role on a
-- fresh project. RLS policies alone are not enough — Postgres checks table-level GRANTs
-- before RLS — so these must be restored explicitly, or every real query from the app
-- fails with "permission denied for table ..." (42501) and silently looks like RLS is
-- just blocking everything.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon, public;
REVOKE SELECT ON public.integration_connections FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_org_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assume_conversation_atomic(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_conversation_atomic(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_member_role_safe(UUID, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_org_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assume_conversation_atomic(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_conversation_atomic(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_member_role_safe(UUID, UUID, TEXT) TO authenticated, service_role;

-- Views
CREATE OR REPLACE VIEW public.integration_connections_public AS
    SELECT 
        id,
        organization_id,
        provider,
        status,
        settings,
        created_at,
        updated_at
    FROM public.integration_connections;

GRANT SELECT ON public.integration_connections_public TO authenticated, service_role;

-- Realtime (Postgres Changes) — the Inbox subscribes to these so new messages and
-- conversation changes (status/assignee) show up live without a manual refresh.
-- Realtime still respects each table's RLS policy for authenticated clients.
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- Storage bucket for chat media (images/videos/audio/documents), both outbound
-- attachments uploaded from the browser and inbound media mirrored from the
-- provider's own hosting for permanence (see 20260807030000_media_messages.sql for the
-- full rationale). Path convention: {organization_id}/{conversation_id}/{file}.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-media', 'chat-media', true, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can upload chat media" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'chat-media'
        AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_org_ids())
    );

CREATE POLICY "Org members can update their own chat media" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'chat-media'
        AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_org_ids())
    );

CREATE POLICY "Public can read chat media" ON storage.objects
    FOR SELECT USING (bucket_id = 'chat-media');

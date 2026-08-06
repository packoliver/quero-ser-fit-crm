-- Migration: fix real (non-demo) CRUD paths that have been broken since they were
-- written, discovered via a full end-to-end audit of every page.
--
-- Root cause #1: `tasks.priority` and `contacts.tags` are used extensively by the
-- frontend but were never added to the schema — any real SELECT/INSERT touching them
-- fails outright (tasks) or silently drops the field (contacts, since the column-not-
-- found error there was masked by the same fallback-to-demo pattern seen before with
-- organization_members.manager/permissions).
--
-- Root cause #2: several client-side INSERTs never supply `organization_id` (NOT NULL,
-- no default) because the app assumed it would be filled in automatically somehow — it
-- never was. Same class of bug as the encryption-key fallback and the missing GRANTs
-- found earlier in this project: something assumed to "just work" that was never wired.
-- Fixed at the database layer with a BEFORE INSERT trigger deriving organization_id
-- from the caller's own membership, so any current or future client-side insert that
-- forgets to set it keeps working instead of failing with a NOT NULL violation.

-- 1. Missing columns the frontend already assumes exist.
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'media'
    CHECK (priority IN ('alta', 'media', 'baixa'));

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- 2. Generic organization_id auto-fill for any org-scoped table a client inserts into
-- directly without supplying it. No-ops (leaves NEW.organization_id untouched) when the
-- caller already provided one, e.g. every server-side admin-client insert in this app.
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

DROP TRIGGER IF EXISTS trg_autofill_org_contacts ON public.contacts;
CREATE TRIGGER trg_autofill_org_contacts
    BEFORE INSERT ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

DROP TRIGGER IF EXISTS trg_autofill_org_tasks ON public.tasks;
CREATE TRIGGER trg_autofill_org_tasks
    BEFORE INSERT ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

DROP TRIGGER IF EXISTS trg_autofill_org_contact_channels ON public.contact_channels;
CREATE TRIGGER trg_autofill_org_contact_channels
    BEFORE INSERT ON public.contact_channels
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

DROP TRIGGER IF EXISTS trg_autofill_org_conversations ON public.conversations;
CREATE TRIGGER trg_autofill_org_conversations
    BEFORE INSERT ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

DROP TRIGGER IF EXISTS trg_autofill_org_messages ON public.messages;
CREATE TRIGGER trg_autofill_org_messages
    BEFORE INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

-- 3. internal_notes needs BOTH organization_id (derived from its conversation, more
-- reliable than "caller's org" since it must match the parent conversation exactly)
-- AND author_id (the writing user) — neither is supplied by the Inbox "Notas Internas"
-- insert today.
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

DROP TRIGGER IF EXISTS trg_autofill_internal_notes ON public.internal_notes;
CREATE TRIGGER trg_autofill_internal_notes
    BEFORE INSERT ON public.internal_notes
    FOR EACH ROW EXECUTE FUNCTION public.set_internal_note_defaults();

-- Migration: sales/post-sale pipeline (funil de vendas).
--
-- Until now the CRM only tracked conversations (chat threads) and contacts — there was
-- no way to see "this client closed a deal, it's now awaiting delivery" separately from
-- the chat itself. `deals` is a Kanban-style pipeline: one row per SALE, not per
-- contact, because recurring clients (very common for this business) can have several
-- deals over time — an old one sitting in "Pós-venda" and a brand new one starting back
-- at "Lead" simultaneously. The chat history in `conversations`/`messages` stays exactly
-- one continuous thread per contact regardless of how many deals they've had; `deals`
-- is a separate, parallel timeline for tracking the sale itself through fulfillment.
CREATE TABLE public.deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    value NUMERIC(12, 2),
    stage TEXT NOT NULL DEFAULT 'lead' CHECK (
        stage IN ('lead', 'negociando', 'fechado', 'entrega', 'posvenda', 'perdido')
    ),
    notes TEXT,
    assigned_to_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deals_org ON public.deals(organization_id);
CREATE INDEX idx_deals_contact ON public.deals(contact_id);
CREATE INDEX idx_deals_stage ON public.deals(organization_id, stage);

CREATE TRIGGER trg_autofill_org_deals
    BEFORE INSERT ON public.deals
    FOR EACH ROW EXECUTE FUNCTION public.set_organization_id_from_caller();

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for deals" ON public.deals
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

-- So a card another salesperson moves shows up live in everyone else's board.
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;

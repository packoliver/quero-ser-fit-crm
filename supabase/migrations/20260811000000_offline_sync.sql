-- Durable idempotency records for authenticated offline mutations.
CREATE TABLE IF NOT EXISTS public.sync_mutations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'rejected', 'conflict')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.sync_mutations
  ADD CONSTRAINT sync_mutations_operation_check
  CHECK (operation IN ('contact.create', 'contact.update', 'task.create', 'task.update', 'deal.create', 'deal.update', 'note.create', 'internal_note.create'));

ALTER TABLE public.sync_mutations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_mutations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_mutations TO service_role;
CREATE INDEX IF NOT EXISTS idx_sync_mutations_expiry ON public.sync_mutations(expires_at);

CREATE OR REPLACE FUNCTION public.purge_expired_sync_mutations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM public.sync_mutations WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_sync_mutations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_sync_mutations() TO service_role;

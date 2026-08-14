CREATE TABLE IF NOT EXISTS public.outbound_message_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_type TEXT,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  external_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.outbound_message_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_message_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outbound_message_attempts TO service_role;

CREATE INDEX IF NOT EXISTS idx_outbound_attempts_conversation
  ON public.outbound_message_attempts(conversation_id);

CREATE OR REPLACE FUNCTION public.set_outbound_attempt_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outbound_attempt_updated_at ON public.outbound_message_attempts;
CREATE TRIGGER trg_outbound_attempt_updated_at
  BEFORE UPDATE ON public.outbound_message_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_outbound_attempt_updated_at();

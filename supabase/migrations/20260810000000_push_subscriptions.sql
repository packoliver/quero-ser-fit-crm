CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage their own push subscriptions"
  ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid() AND organization_id IN (SELECT public.get_user_org_ids()))
  WITH CHECK (user_id = auth.uid() AND organization_id IN (SELECT public.get_user_org_ids()));
REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_org ON public.push_subscriptions(organization_id);

CREATE OR REPLACE FUNCTION public.set_push_subscription_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_push_subscription_updated_at();

-- Security follow-up corrections for generated databases.

DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Service role or authenticated users can manage webhook events" ON public.webhook_events;
DROP POLICY IF EXISTS "Public can read chat media" ON storage.objects;

CREATE POLICY "Users view profiles in their organizations" ON public.profiles
  FOR SELECT USING (
    id IN (
      SELECT om2.user_id
      FROM public.organization_members om1
      JOIN public.organization_members om2 ON om1.organization_id = om2.organization_id
      WHERE om1.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Service role can manage profiles" ON public.profiles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Only service role can manage webhook events" ON public.webhook_events
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

UPDATE storage.buckets SET public = false WHERE id = 'chat-media';

CREATE POLICY "Org members can read chat media" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_org_ids())
  );

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_organization_id_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_id
  ON public.contacts(organization_id, id);

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_org_contact_fk;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_org_contact_fk
  FOREIGN KEY (organization_id, contact_id)
  REFERENCES public.contacts(organization_id, id);


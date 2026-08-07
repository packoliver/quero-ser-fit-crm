-- Migration: image/video/audio/document support for messages.
--
-- `media_type` classifies what's in `media_url` (already existed, unused until now) so
-- the Inbox knows how to render it (<img>, <video>, <audio>, or a download link).
--
-- The `chat-media` Storage bucket holds:
--   - outbound attachments uploaded directly from the browser (Inbox → paperclip), and
--   - inbound media mirrored from the provider's own hosting (uazapi's /message/download
--     link expires after 2 days on their side; Meta's media URLs require a Bearer token
--     and expire in minutes) into something permanent and publicly fetchable — both by
--     WhatsApp/Instagram's servers (outbound) and by our own <img>/<video> tags (inbound).
--
-- Path convention enforced by the upload policy: {organization_id}/{conversation_id}/{file}
-- — keeps each org's uploads scoped to their own folder, matching the tenant-isolation
-- pattern used everywhere else in this schema.

ALTER TABLE public.messages
    ADD COLUMN media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'document', 'sticker'));

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

-- Public SELECT is required: outbound uploads must be fetchable by WhatsApp/Instagram's
-- servers (which have no Supabase auth), and inbound mirrored media is displayed via
-- plain <img>/<video> src in the browser.
CREATE POLICY "Public can read chat media" ON storage.objects
    FOR SELECT USING (bucket_id = 'chat-media');

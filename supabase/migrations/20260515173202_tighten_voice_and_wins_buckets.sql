-- Voice bucket: bishop/admin only. Currently the bucket is covered by
-- kg_buckets_auth_* (any authenticated). Bishop blasts and devotion media
-- (both bishop-only flows) are the only legitimate writers. Drop voice
-- from the broad policies and add scoped ones.
DROP POLICY IF EXISTS kg_buckets_auth_insert ON storage.objects;
CREATE POLICY kg_buckets_auth_insert ON storage.objects FOR INSERT
  WITH CHECK (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = ANY (ARRAY['avatars'::text, 'wins'::text, 'announcements'::text]))
  );

DROP POLICY IF EXISTS kg_buckets_auth_update ON storage.objects;
CREATE POLICY kg_buckets_auth_update ON storage.objects FOR UPDATE
  USING (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = ANY (ARRAY['avatars'::text, 'wins'::text, 'announcements'::text]))
    AND ((owner = auth.uid()) OR is_bishop())
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = ANY (ARRAY['avatars'::text, 'wins'::text, 'announcements'::text]))
    AND ((owner = auth.uid()) OR is_bishop())
  );

DROP POLICY IF EXISTS kg_buckets_auth_delete ON storage.objects;
CREATE POLICY kg_buckets_auth_delete ON storage.objects FOR DELETE
  USING (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = ANY (ARRAY['avatars'::text, 'wins'::text, 'announcements'::text]))
    AND ((owner = auth.uid()) OR is_bishop())
  );

-- Voice-bucket policies: bishop/admin only on every action.
DROP POLICY IF EXISTS voice_bishop_insert ON storage.objects;
CREATE POLICY voice_bishop_insert ON storage.objects FOR INSERT
  WITH CHECK (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = 'voice'::text)
    AND is_bishop()
  );

DROP POLICY IF EXISTS voice_bishop_select ON storage.objects;
CREATE POLICY voice_bishop_select ON storage.objects FOR SELECT
  USING (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = 'voice'::text)
  );

DROP POLICY IF EXISTS voice_bishop_update ON storage.objects;
CREATE POLICY voice_bishop_update ON storage.objects FOR UPDATE
  USING (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = 'voice'::text)
    AND is_bishop()
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = 'voice'::text)
    AND is_bishop()
  );

DROP POLICY IF EXISTS voice_bishop_delete ON storage.objects;
CREATE POLICY voice_bishop_delete ON storage.objects FOR DELETE
  USING (
    (auth.uid() IS NOT NULL)
    AND (bucket_id = 'voice'::text)
    AND is_bishop()
  );

-- Voice bucket file constraints. 50MB matches uploadDevotionMedia's
-- client-side cap (devotion videos go here too). 10 min of audio is well
-- under that. MIME list covers the formats the bishop's MediaRecorder
-- emits and the formats his phone produces for video uploads.
UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY[
      'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav',
      'video/mp4','video/webm','video/quicktime'
    ]
WHERE id = 'voice';

-- Wins bucket: match the announcements/avatars story. 10MB image cap.
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
WHERE id = 'wins';

-- ============================================================
-- Storage uploads: anon -> authenticated
--
-- After Phase 1 the REST API was locked to authenticated. Storage
-- bucket uploads still allowed anon by leftover policies from the
-- pre-auth era. Tighten so only authenticated users can write.
--
-- Public buckets stay public=true at the bucket level — direct URL
-- fetches work without a session (browsers loading <img src=...>).
-- Only LIST and WRITE require auth now.
-- ============================================================

-- Drop the seven leftover anon policies
drop policy if exists anon_delete_avatars       on storage.objects;
drop policy if exists anon_update_avatars       on storage.objects;
drop policy if exists anon_upload_announcements on storage.objects;
drop policy if exists anon_upload_avatars       on storage.objects;
drop policy if exists voice_anon_insert         on storage.objects;
drop policy if exists wins_anon_insert          on storage.objects;
drop policy if exists wins_anon_update          on storage.objects;

-- Drop any prior versions of the authenticated policies (idempotent replay)
drop policy if exists kg_buckets_auth_insert on storage.objects;
drop policy if exists kg_buckets_auth_update on storage.objects;
drop policy if exists kg_buckets_auth_delete on storage.objects;

-- One unified set of policies for our four buckets.
-- INSERT: any authenticated user may upload to any of our public buckets.
create policy kg_buckets_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','wins','voice','announcements'));

-- UPDATE / DELETE: only the owner of the object may modify or remove it,
-- OR the bishop. storage.objects.owner stores the auth.uid() of the
-- uploader; if null (legacy), bishop is the only one allowed to clean up.
create policy kg_buckets_auth_update on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars','wins','voice','announcements')
    and (owner = auth.uid() or is_bishop())
  )
  with check (
    bucket_id in ('avatars','wins','voice','announcements')
    and (owner = auth.uid() or is_bishop())
  );

create policy kg_buckets_auth_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars','wins','voice','announcements')
    and (owner = auth.uid() or is_bishop())
  );

SELECT policyname, roles::text AS roles, cmd FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;

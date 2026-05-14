-- ============================================================
-- Ministry photos bucket
--
-- Separate from the credentials bucket. Pastors upload photos
-- documenting their ministry (church, events, milestones, family
-- of faith) into ministry-photos/{auth.uid()}/<filename>. Every
-- authenticated user in the network may VIEW any photo — that's
-- the fellowship intent. Pastors write only their own folder.
-- Bishop/admin (via is_bishop()) can write or delete anywhere
-- for moderation.
--
-- Bucket is NOT public — fetching a photo requires an authenticated
-- session (via /storage/v1/object/sign/... or /storage/v1/object/...
-- with a Bearer access_token).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ministry-photos',
  'ministry-photos',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Idempotent replay safety.
drop policy if exists ministry_photos_insert on storage.objects;
drop policy if exists ministry_photos_network_read on storage.objects;
drop policy if exists ministry_photos_update on storage.objects;
drop policy if exists ministry_photos_delete on storage.objects;

-- INSERT: authenticated user uploads to their own folder; bishop/admin
-- may upload to any folder (moderation / promotional repost).
create policy ministry_photos_insert on storage.objects for insert to public
  with check (
    auth.uid() is not null
    and bucket_id = 'ministry-photos'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

-- SELECT: any authenticated user can view any ministry photo. The
-- network-wide visibility is the entire reason this bucket is separate
-- from credentials.
create policy ministry_photos_network_read on storage.objects for select to public
  using (
    auth.uid() is not null
    and bucket_id = 'ministry-photos'
  );

-- UPDATE: own folder only, or bishop/admin.
create policy ministry_photos_update on storage.objects for update to public
  using (
    auth.uid() is not null
    and bucket_id = 'ministry-photos'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  )
  with check (
    auth.uid() is not null
    and bucket_id = 'ministry-photos'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

-- DELETE: own folder only, or bishop/admin.
create policy ministry_photos_delete on storage.objects for delete to public
  using (
    auth.uid() is not null
    and bucket_id = 'ministry-photos'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

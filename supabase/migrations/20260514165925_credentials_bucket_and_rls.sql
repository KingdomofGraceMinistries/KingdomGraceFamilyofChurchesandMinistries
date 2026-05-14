-- ============================================================
-- Credentials + photos bucket
--
-- Private storage bucket for each pastor's credential scans
-- (ordination certs, ministerial licenses) and personal/ministry
-- photos. Bishop and admins (via is_bishop() helper which already
-- accepts both 'bishop' and 'admin' app_metadata.role values) can
-- read every pastor's folder; pastors see only their own folder.
--
-- Path convention: credentials/{auth.uid()}/<filename>
-- The first folder segment is the auth user id, so the RLS gate
-- can match (storage.foldername(name))[1] = auth.uid()::text.
--
-- Bucket is NOT public — no /object/public/ access. The client
-- must request a signed URL from /storage/v1/object/sign/... using
-- an authenticated session, and PostgREST + storage policies will
-- gate that.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'credentials',
  'credentials',
  false,
  20971520,
  array[
    'application/pdf',
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

-- Drop any prior versions for idempotent replay.
drop policy if exists cred_self_insert on storage.objects;
drop policy if exists cred_self_select on storage.objects;
drop policy if exists cred_self_update on storage.objects;
drop policy if exists cred_self_delete on storage.objects;

-- INSERT: authenticated user may upload into a folder named for their
-- auth.uid(). Bishop/admin (via is_bishop()) may upload anywhere in the
-- bucket — useful if Bishop ever needs to attach a doc to a pastor file.
create policy cred_self_insert on storage.objects for insert to public
  with check (
    auth.uid() is not null
    and bucket_id = 'credentials'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

-- SELECT: own folder, or bishop/admin sees all.
create policy cred_self_select on storage.objects for select to public
  using (
    auth.uid() is not null
    and bucket_id = 'credentials'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

-- UPDATE (re-upload / metadata change): own folder, or bishop/admin.
create policy cred_self_update on storage.objects for update to public
  using (
    auth.uid() is not null
    and bucket_id = 'credentials'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  )
  with check (
    auth.uid() is not null
    and bucket_id = 'credentials'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

-- DELETE: own folder, or bishop/admin.
create policy cred_self_delete on storage.objects for delete to public
  using (
    auth.uid() is not null
    and bucket_id = 'credentials'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_bishop()
    )
  );

-- Column to remember the last credential the pastor uploaded so the
-- profile screen + bishop view can fetch it via signed URL.
alter table rf_pastors
  add column if not exists credential_doc_path        text,
  add column if not exists credential_doc_uploaded_at timestamptz;

grant update (credential_doc_path, credential_doc_uploaded_at)
  on rf_pastors to authenticated;

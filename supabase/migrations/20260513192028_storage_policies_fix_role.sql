-- Switch storage policies from `to authenticated` (role-based) to
-- `to public using auth.uid() IS NOT NULL` (identity-based). Supabase
-- Storage's role-routing for JWTs occasionally maps to the public role
-- even when authenticated, so this is the more reliable pattern.
drop policy if exists kg_buckets_auth_insert on storage.objects;
drop policy if exists kg_buckets_auth_update on storage.objects;
drop policy if exists kg_buckets_auth_delete on storage.objects;

create policy kg_buckets_auth_insert on storage.objects for insert to public
  with check (
    auth.uid() is not null
    and bucket_id in ('avatars','wins','voice','announcements')
  );

create policy kg_buckets_auth_update on storage.objects for update to public
  using (
    auth.uid() is not null
    and bucket_id in ('avatars','wins','voice','announcements')
    and (owner = auth.uid() or is_bishop())
  )
  with check (
    auth.uid() is not null
    and bucket_id in ('avatars','wins','voice','announcements')
    and (owner = auth.uid() or is_bishop())
  );

create policy kg_buckets_auth_delete on storage.objects for delete to public
  using (
    auth.uid() is not null
    and bucket_id in ('avatars','wins','voice','announcements')
    and (owner = auth.uid() or is_bishop())
  );

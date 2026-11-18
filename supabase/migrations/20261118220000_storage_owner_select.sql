-- ============================================================
-- 2026-11-18 — owners and staff can find (and so delete) their own
-- files in the avatars / wins / announcements buckets.
--
-- SEC-15 (2026-05-13) dropped the public SELECT-list policies on these
-- buckets. Right for listing — but Storage resolves a DELETE or UPDATE
-- through SELECT first, so with no SELECT policy at all, every delete
-- in these buckets matched nothing and reported success. Found during a
-- synthetic-pastor test on 2026-11-18: the pastor's own delete of their
-- two profile photos returned "deleted 0 of 2".
--
-- The new SELECT policy is scoped exactly like the existing UPDATE /
-- DELETE policies: the file's owner, or the bishop/admins. Signed-out
-- visitors still list nothing, and pastors cannot list one another's
-- uploads. Public object URLs keep working — those buckets are public,
-- and a public URL does not consult RLS.
--
-- Also: the UPDATE / DELETE policies compared `owner` (uuid), which
-- Supabase Storage has deprecated in favour of `owner_id` (text). All
-- three now use owner_id, and are scoped `to authenticated` rather than
-- relying on `auth.uid() is not null` under the default public role.
-- ============================================================

drop policy if exists kg_buckets_owner_select on storage.objects;
create policy kg_buckets_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = any (array['avatars', 'wins', 'announcements'])
    and (owner_id = (select auth.uid())::text or is_bishop())
  );

drop policy if exists kg_buckets_auth_update on storage.objects;
create policy kg_buckets_auth_update on storage.objects
  for update to authenticated
  using (
    bucket_id = any (array['avatars', 'wins', 'announcements'])
    and (owner_id = (select auth.uid())::text or is_bishop())
  )
  with check (
    bucket_id = any (array['avatars', 'wins', 'announcements'])
    and (owner_id = (select auth.uid())::text or is_bishop())
  );

drop policy if exists kg_buckets_auth_delete on storage.objects;
create policy kg_buckets_auth_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = any (array['avatars', 'wins', 'announcements'])
    and (owner_id = (select auth.uid())::text or is_bishop())
  );

-- Post-migration assertions -----------------------------------------
do $$
declare
  p record;
begin
  for p in
    select policyname, roles, qual
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('kg_buckets_owner_select', 'kg_buckets_auth_update', 'kg_buckets_auth_delete')
  loop
    if not (p.roles = array['authenticated']::name[]) then
      raise exception '% is not scoped to authenticated', p.policyname;
    end if;
    if p.qual not like '%owner_id%' then
      raise exception '% does not use owner_id', p.policyname;
    end if;
  end loop;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('kg_buckets_owner_select', 'kg_buckets_auth_update', 'kg_buckets_auth_delete')) <> 3 then
    raise exception 'expected three kg_buckets policies';
  end if;
end $$;

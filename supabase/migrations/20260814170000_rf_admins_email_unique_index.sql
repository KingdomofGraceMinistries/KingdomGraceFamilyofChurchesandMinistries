-- ============================================================
-- 2026-08-14 — record the rf_admins email uniqueness index.
--
-- This index already exists in production but was never captured
-- in a migration, so an environment rebuilt from this directory
-- alone would silently lack it. Recording it here closes that
-- drift; the statement is idempotent and a no-op against prod.
--
-- Why lower(email) rather than a plain unique(email): every write
-- path lowercases before insert (create_admin(), addAdmin()) and
-- kgfcm-pin-login lowercases before lookup, but nothing enforced
-- that at the column level. A direct write with mixed case would
-- slip past a plain unique(email) and then break login, which
-- resolves the row with .maybeSingle() and errors on duplicates.
--
-- The partial WHERE clause keeps the legacy nullable email column
-- usable: rows predating the email requirement stay valid, and
-- multiple NULLs do not collide.
--
-- Note: this index is load-bearing for kgfcm-pin-login. The
-- bishop bootstrap path relied on it to reject a duplicate
-- rf_admins insert on every login (see the same-dated fix to
-- ensureAuthUser, which updates the existing row instead).
-- ============================================================

create unique index if not exists idx_rf_admins_email
  on public.rf_admins (lower(email))
  where email is not null;

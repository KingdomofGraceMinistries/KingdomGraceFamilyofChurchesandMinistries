-- The previous SELECT policy on rf_announcements only let pastors see
-- status='active' rows (or any row if bishop). When a pastor soft-deletes
-- their own announcement (UPDATE status='removed') via PostgREST, the
-- request includes Prefer: return=representation, which makes Postgres
-- run UPDATE ... RETURNING. RETURNING requires the new row state to be
-- visible under the SELECT policy. Once status flipped to 'removed',
-- Maria's SELECT policy stopped matching her own row -> entire UPDATE
-- failed with "violates row-level security policy".
--
-- Extend the read policy: a pastor can always see their own announcements
-- regardless of status, so UPDATE...RETURNING resolves cleanly.
DROP POLICY IF EXISTS ann_auth_read ON rf_announcements;
CREATE POLICY ann_auth_read ON rf_announcements FOR SELECT
  USING (
    (status = 'active'::text)
    OR is_bishop()
    OR (pastor_id = (pastor_id_for_current_user())::text)
  );

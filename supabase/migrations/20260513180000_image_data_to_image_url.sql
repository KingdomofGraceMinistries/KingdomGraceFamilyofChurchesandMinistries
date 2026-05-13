-- ============================================================
-- 20260513180000 — Rename image_data → image_url (SEC-9)
--
-- The legacy column name suggested base64 blobs lived in the
-- column; in practice the client always stored bucket URLs.
-- Renaming makes the contract explicit and removes the temptation
-- to write base64 back in. Migration 003 set up the wins bucket;
-- this commit makes the column name match.
--
-- Zero rows had non-null image_data when the rename was applied,
-- so no data carries over. Future writes go straight to the
-- public buckets via the existing storageUpload() helper.
-- ============================================================

alter table rf_wins          rename column image_data to image_url;
alter table rf_announcements rename column image_data to image_url;

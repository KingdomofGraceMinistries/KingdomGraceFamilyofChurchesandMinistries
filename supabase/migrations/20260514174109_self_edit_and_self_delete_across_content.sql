-- ============================================================
-- Self-edit + self-delete on every user-authored table
--
-- Pastors and bishop must be able to edit and delete THEIR OWN
-- content anywhere they can input — prayer requests, wins,
-- comments, DMs, announcements, team responses, check-ins,
-- breakthrough notes, bishop blasts, calendar events.
--
-- Hard-delete (no deleted_at column) so when a pastor pulls
-- something down it's truly gone. Audit log captures who removed
-- what but not the content.
--
-- Bishop-level moderation of OTHER pastors' content is already
-- covered by existing is_bishop() policies.
-- ============================================================

-- 1. edited_at columns
alter table rf_prayer_requests   add column if not exists edited_at timestamptz;
alter table rf_wins              add column if not exists edited_at timestamptz;
alter table rf_win_comments      add column if not exists edited_at timestamptz;
alter table rf_direct_messages   add column if not exists edited_at timestamptz;
alter table rf_announcements     add column if not exists edited_at timestamptz;
alter table rf_team_responses    add column if not exists edited_at timestamptz;
alter table rf_checkins          add column if not exists edited_at timestamptz;
alter table rf_fast_participants add column if not exists edited_at timestamptz;
alter table rf_bishop_messages   add column if not exists edited_at timestamptz;
alter table rf_events            add column if not exists edited_at timestamptz;

-- 2. Column-level UPDATE grants on editable text fields
grant update (request_text, edited_at)              on rf_prayer_requests to authenticated;
grant update (win_text, image_url, edited_at)       on rf_wins to authenticated;
grant update (comment_text, edited_at)              on rf_win_comments to authenticated;
grant update (message_text, edited_at)              on rf_direct_messages to authenticated;
grant update (title, body, image_url, is_pinned, status, edited_at) on rf_announcements to authenticated;
grant update (response_text, edited_at)             on rf_team_responses to authenticated;
grant update (notes, pulse_score, edited_at)        on rf_checkins to authenticated;
grant update (breakthrough_text, edited_at)         on rf_fast_participants to authenticated;
grant update (message_text, audio_url, edited_at)   on rf_bishop_messages to authenticated;
grant update (title, description, event_date, end_date, event_time, event_type, location, location_url, is_virtual, edited_at)
  on rf_events to authenticated;

-- 3. rf_direct_messages: sender edit + delete (gap)
drop policy if exists dm_sender_update on rf_direct_messages;
create policy dm_sender_update on rf_direct_messages for update to authenticated
  using      (sender_id = (pastor_id_for_current_user())::text or is_bishop())
  with check (sender_id = (pastor_id_for_current_user())::text or is_bishop());

drop policy if exists dm_sender_delete on rf_direct_messages;
create policy dm_sender_delete on rf_direct_messages for delete to authenticated
  using (sender_id = (pastor_id_for_current_user())::text or is_bishop());

-- 4. Self-delete on wins / prayer / team / fast (gap)
drop policy if exists wins_self_delete on rf_wins;
create policy wins_self_delete on rf_wins for delete to authenticated
  using (pastor_id = pastor_id_for_current_user() or is_bishop());

drop policy if exists prayer_self_delete on rf_prayer_requests;
create policy prayer_self_delete on rf_prayer_requests for delete to authenticated
  using (pastor_id = pastor_id_for_current_user() or is_bishop());

drop policy if exists team_self_delete on rf_team_responses;
create policy team_self_delete on rf_team_responses for delete to authenticated
  using (pastor_id = pastor_id_for_current_user() or is_bishop());

drop policy if exists fp_self_delete on rf_fast_participants;
create policy fp_self_delete on rf_fast_participants for delete to authenticated
  using (pastor_id = pastor_id_for_current_user() or is_bishop());

-- 5. rf_checkins: self update + delete (gap)
drop policy if exists checkins_self_update on rf_checkins;
create policy checkins_self_update on rf_checkins for update to authenticated
  using      (pastor_id = pastor_id_for_current_user() or is_bishop())
  with check (pastor_id = pastor_id_for_current_user() or is_bishop());

drop policy if exists checkins_self_delete on rf_checkins;
create policy checkins_self_delete on rf_checkins for delete to authenticated
  using (pastor_id = pastor_id_for_current_user() or is_bishop());

-- 6. rf_bishop_messages: bishop can delete own broadcasts
drop policy if exists bishop_msg_bishop_delete on rf_bishop_messages;
create policy bishop_msg_bishop_delete on rf_bishop_messages for delete to authenticated
  using (is_bishop());

-- 7. rf_events: events_bishop_write is ALL so bishop has UPDATE+DELETE already.
-- edited_at column + grant added in sections 1+2.

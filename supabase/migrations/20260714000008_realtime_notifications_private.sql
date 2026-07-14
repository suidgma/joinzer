-- Private-channel authorization for the per-user notifications broadcast topic. Only the
-- user themselves may receive broadcasts on notifications:<their-uid>. realtime.messages
-- has RLS enabled (deny-all) already; this is the first policy, so it only affects channels
-- opened with { config: { private: true } } — existing public channels are unaffected.
-- Server sends via the HTTP broadcast API (service role), which bypasses RLS.
create policy "realtime: receive own notifications" on realtime.messages
  for select to authenticated
  using ((select realtime.topic()) = 'notifications:' || (select auth.uid())::text);

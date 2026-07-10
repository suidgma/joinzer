-- Security fix: the analytics "_pdt" views were SELECT-granted to anon/authenticated,
-- exposing them over the public REST API (anon key ships in the frontend):
--   • email_log_pdt  → every email recipient address + subject we've sent
--   • logins_pdt     → every user's name/display_name + last_login (bypasses discoverable)
-- Restrict to server-side roles only (service_role/postgres retain access, so any
-- direct-connection BI tool still works). Reversible with GRANT SELECT … TO … .
revoke select on public.email_log_pdt from anon, authenticated;
revoke select on public.logins_pdt from anon, authenticated;

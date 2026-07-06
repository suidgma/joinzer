-- Allow a bare profile (user_id only, no registration or guest name) as an
-- attendee. Box-league subs work like round-robin now: the Add Sub pool is any
-- profile, and most subs aren't registered league members — so they carry a
-- user_id with no registration_id.

alter table league_attendance drop constraint league_attendance_attendee;
alter table league_attendance add constraint league_attendance_attendee
  check (registration_id is not null or user_id is not null or guest_name is not null);

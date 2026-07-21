-- Leagues get the tournament publishing model: a draft state, public/private visibility, and
-- organizer contact. Existing leagues are all status='active' (= published), so they're unaffected.
alter table public.leagues
  add column if not exists visibility text not null default 'public',
  add column if not exists contact_name text,
  add column if not exists contact_email text;

-- Extend the existing status check to allow 'draft'.
alter table public.leagues drop constraint leagues_status_check;
alter table public.leagues add constraint leagues_status_check check (status in ('draft', 'active', 'completed', 'cancelled'));

alter table public.leagues add constraint leagues_visibility_check check (visibility in ('public', 'private'));

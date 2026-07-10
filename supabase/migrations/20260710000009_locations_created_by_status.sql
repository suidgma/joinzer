-- Track who added a location and gate user-added ones behind approval.
-- Existing (curated) rows backfill to 'approved'; the create route sets 'pending'
-- for user-entered venues, which stay hidden from other users' pickers until
-- approved (the creator still sees their own).
alter table public.locations
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists status text not null default 'approved'
    check (status in ('approved', 'pending'));

create index if not exists locations_status_idx on public.locations (status);
create index if not exists locations_created_by_idx on public.locations (created_by);

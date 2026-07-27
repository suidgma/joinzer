-- Directory — add 'unresolved_unnamed' to facility_candidates.research_status (pipeline V3: shelved
-- unnamed pins). This was applied to the live DB ad-hoc on 2026-07-24; this file catches the repo up
-- so a from-scratch rebuild reproduces production (idempotent drop+recreate of the CHECK). No data change.
alter table public.facility_candidates drop constraint if exists facility_candidates_research_status_check;
alter table public.facility_candidates add constraint facility_candidates_research_status_check
  check (research_status in ('pending','verified','probable','unresolved','unresolved_unnamed','duplicate','not_venue','not_pickleball','held','published'));

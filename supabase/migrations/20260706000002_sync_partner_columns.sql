-- Keep the two league partner columns in sync. The box engine folds doubles teams
-- via partner_registration_id, while the round-robin fixed-partner scheduler and the
-- organizer pairing route wrote partner_user_id — so organizer-paired players didn't
-- carry over to box seeding. Backfill each column from the other (idempotent).
-- Going forward, /api/leagues/[id]/assign-partner sets both.

update league_registrations r set partner_registration_id = p.id
from league_registrations p
where p.league_id = r.league_id and p.user_id = r.partner_user_id
  and r.partner_user_id is not null and r.partner_registration_id is null;

update league_registrations r set partner_user_id = p.user_id
from league_registrations p
where p.id = r.partner_registration_id
  and r.partner_registration_id is not null and r.partner_user_id is null;

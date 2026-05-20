-- Returns true if viewer_id is an organizer or co-admin of any competition
-- that target_id has a non-cancelled registration in.
-- Used to enforce 'captains' visibility tier on profiles.email/phone.
CREATE OR REPLACE FUNCTION public.is_captain_of(viewer_id uuid, target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Tournament organizer for any tournament target is registered in
    SELECT 1
    FROM tournament_registrations tr
    JOIN tournaments t ON t.id = tr.tournament_id
    WHERE tr.user_id = target_id
      AND tr.status != 'cancelled'
      AND t.organizer_id = viewer_id

    UNION

    -- Tournament staff (any role) for any tournament target is registered in
    SELECT 1
    FROM tournament_registrations tr
    JOIN tournament_staff ts ON ts.tournament_id = tr.tournament_id
    WHERE tr.user_id = target_id
      AND tr.status != 'cancelled'
      AND ts.user_id = viewer_id

    UNION

    -- League organizer for any league target is registered in
    SELECT 1
    FROM league_registrations lr_target
    JOIN leagues l ON l.id = lr_target.league_id
    WHERE lr_target.user_id = target_id
      AND lr_target.status != 'cancelled'
      AND l.created_by = viewer_id

    UNION

    -- League co-admin for any league target is registered in
    SELECT 1
    FROM league_registrations lr_target
    JOIN league_registrations lr_admin
      ON lr_admin.league_id = lr_target.league_id
    WHERE lr_target.user_id = target_id
      AND lr_target.status != 'cancelled'
      AND lr_admin.user_id = viewer_id
      AND lr_admin.is_co_admin = true
  );
$$;

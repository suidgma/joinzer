-- Fix: register_doubles_pair must write payment_status='waived' for free divisions
-- instead of hardcoding 'unpaid'. Derives from tournament_divisions.cost_cents which
-- is already locked via SELECT ... FOR UPDATE at the top of the function.

CREATE OR REPLACE FUNCTION register_doubles_pair(
  p_tournament_id  uuid,
  p_division_id    uuid,
  p_player1_id     uuid,
  p_player2_id     uuid,
  p_team_name      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_div        tournament_divisions%ROWTYPE;
  v_slot_count integer;
  v_status     text;
  v_reg1_id    uuid;
  v_reg2_id    uuid;
BEGIN
  -- Lock division row to serialise concurrent organiser adds
  SELECT * INTO v_div
    FROM tournament_divisions
   WHERE id = p_division_id AND tournament_id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'division_not_found';
  END IF;

  IF v_div.status = 'closed' THEN
    RAISE EXCEPTION 'division_closed';
  END IF;

  -- Validate this is a doubles format
  IF v_div.format NOT IN (
    'mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles', 'open_doubles'
  ) THEN
    RAISE EXCEPTION 'not_doubles_format';
  END IF;

  -- Duplicate check: neither player already has an active registration here
  IF EXISTS (
    SELECT 1 FROM tournament_registrations
     WHERE division_id = p_division_id
       AND user_id IN (p_player1_id, p_player2_id)
       AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- Gender validation for gendered formats only; mixed/coed/open are unrestricted
  IF v_div.format = 'mens_doubles' THEN
    IF EXISTS (
      SELECT 1 FROM profiles
       WHERE id IN (p_player1_id, p_player2_id)
         AND (gender IS NULL OR gender <> 'male')
    ) THEN
      RAISE EXCEPTION 'gender_mismatch';
    END IF;
  ELSIF v_div.format = 'womens_doubles' THEN
    IF EXISTS (
      SELECT 1 FROM profiles
       WHERE id IN (p_player1_id, p_player2_id)
         AND (gender IS NULL OR gender <> 'female')
    ) THEN
      RAISE EXCEPTION 'gender_mismatch';
    END IF;
  END IF;

  -- Capacity: each registered pair occupies 2 rows; full when slot_count >= max_entries * 2.
  -- Safe placeholder — see note at top of original migration.
  SELECT COUNT(*) INTO v_slot_count
    FROM tournament_registrations
   WHERE division_id = p_division_id
     AND status = 'registered';

  IF v_slot_count >= v_div.max_entries * 2 THEN
    IF NOT v_div.waitlist_enabled THEN
      RAISE EXCEPTION 'division_full';
    END IF;
    v_status := 'waitlisted';
  ELSE
    v_status := 'registered';
  END IF;

  -- Insert P1
  INSERT INTO tournament_registrations (
    tournament_id, division_id, user_id, team_name,
    status, registration_type, payment_status, checked_in
  ) VALUES (
    p_tournament_id, p_division_id, p_player1_id, p_team_name,
    v_status, 'team',
    CASE WHEN v_div.cost_cents IS NULL OR v_div.cost_cents = 0 THEN 'waived' ELSE 'unpaid' END,
    false
  ) RETURNING id INTO v_reg1_id;

  -- Insert P2
  INSERT INTO tournament_registrations (
    tournament_id, division_id, user_id, team_name,
    status, registration_type, payment_status, checked_in
  ) VALUES (
    p_tournament_id, p_division_id, p_player2_id, p_team_name,
    v_status, 'team',
    CASE WHEN v_div.cost_cents IS NULL OR v_div.cost_cents = 0 THEN 'waived' ELSE 'unpaid' END,
    false
  ) RETURNING id INTO v_reg2_id;

  -- Cross-link partner IDs — mirrors solo auto-match pattern (route lines 148-157)
  UPDATE tournament_registrations
     SET partner_user_id = p_player2_id, partner_registration_id = v_reg2_id
   WHERE id = v_reg1_id;

  UPDATE tournament_registrations
     SET partner_user_id = p_player1_id, partner_registration_id = v_reg1_id
   WHERE id = v_reg2_id;

  RETURN jsonb_build_object(
    'reg1_id', v_reg1_id,
    'reg2_id', v_reg2_id,
    'status',  v_status
  );
END;
$$;

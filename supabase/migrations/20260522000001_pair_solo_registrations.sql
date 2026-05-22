-- Atomically cross-link two existing solo registrations as partners.
-- Guards: both rows must be registration_type='solo', status='registered',
-- partner_registration_id IS NULL, and in the same division.
-- Rows are locked in UUID order to prevent deadlock under concurrent requests.

CREATE OR REPLACE FUNCTION pair_solo_registrations(
  p_reg1_id uuid,
  p_reg2_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reg1 tournament_registrations%ROWTYPE;
  v_reg2 tournament_registrations%ROWTYPE;
BEGIN
  -- Lock in UUID order to prevent deadlock
  IF p_reg1_id < p_reg2_id THEN
    SELECT * INTO v_reg1 FROM tournament_registrations WHERE id = p_reg1_id FOR UPDATE;
    SELECT * INTO v_reg2 FROM tournament_registrations WHERE id = p_reg2_id FOR UPDATE;
  ELSE
    SELECT * INTO v_reg2 FROM tournament_registrations WHERE id = p_reg2_id FOR UPDATE;
    SELECT * INTO v_reg1 FROM tournament_registrations WHERE id = p_reg1_id FOR UPDATE;
  END IF;

  IF v_reg1.id IS NULL THEN RAISE EXCEPTION 'reg1_not_found'; END IF;
  IF v_reg2.id IS NULL THEN RAISE EXCEPTION 'reg2_not_found'; END IF;

  -- Positive allowlist: solo, registered, unpartnered
  IF v_reg1.registration_type != 'solo' OR v_reg1.status != 'registered' OR v_reg1.partner_registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_reg1';
  END IF;
  IF v_reg2.registration_type != 'solo' OR v_reg2.status != 'registered' OR v_reg2.partner_registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_reg2';
  END IF;

  IF v_reg1.division_id != v_reg2.division_id THEN
    RAISE EXCEPTION 'different_divisions';
  END IF;

  -- Self-guarding UPDATE: WHERE clauses repeat the guards so any race that
  -- sneaks past the FOR UPDATE (shouldn't happen, but belt-and-suspenders)
  -- produces 0 rows and the function errors rather than silently half-linking.
  UPDATE tournament_registrations
    SET partner_user_id = v_reg2.user_id, partner_registration_id = p_reg2_id
    WHERE id = p_reg1_id AND partner_registration_id IS NULL AND status = 'registered';

  UPDATE tournament_registrations
    SET partner_user_id = v_reg1.user_id, partner_registration_id = p_reg1_id
    WHERE id = p_reg2_id AND partner_registration_id IS NULL AND status = 'registered';

  RETURN jsonb_build_object('reg1_id', p_reg1_id, 'reg2_id', p_reg2_id);
END;
$$;

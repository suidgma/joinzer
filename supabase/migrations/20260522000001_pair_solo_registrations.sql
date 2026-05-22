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
  v_reg1  tournament_registrations%ROWTYPE;
  v_reg2  tournament_registrations%ROWTYPE;
  v_count integer;
BEGIN
  IF p_reg1_id = p_reg2_id THEN
    RAISE EXCEPTION 'cannot_pair_with_self';
  END IF;

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

  -- Self-guarding UPDATEs with row-count check: if either returns 0 rows
  -- (shouldn't happen under FOR UPDATE, but catches any future mutation path),
  -- raise before returning so the caller never sees silent half-linking.
  UPDATE tournament_registrations
    SET partner_user_id = v_reg2.user_id, partner_registration_id = p_reg2_id
    WHERE id = p_reg1_id AND partner_registration_id IS NULL AND status = 'registered';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RAISE EXCEPTION 'pair_write_failed'; END IF;

  UPDATE tournament_registrations
    SET partner_user_id = v_reg1.user_id, partner_registration_id = p_reg1_id
    WHERE id = p_reg2_id AND partner_registration_id IS NULL AND status = 'registered';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RAISE EXCEPTION 'pair_write_failed'; END IF;

  RETURN jsonb_build_object('reg1_id', p_reg1_id, 'reg2_id', p_reg2_id);
END;
$$;

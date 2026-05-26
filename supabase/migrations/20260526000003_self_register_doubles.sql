-- Phase-0 hardening: atomic doubles registration for free divisions.
-- Replaces the compensating-delete pattern in register/route.ts with two true transactions.
--
-- self_register_doubles   — captain registers + invite created atomically (free path only)
-- accept_free_partner_invite — partner claims invite + registration created atomically
--
-- Paid captain path is a separate design ticket (both-pay-separately, mirrors leagues).
-- partner_registration_id is intentionally NOT populated — it is a dead column in prod;
-- partner_user_id is the sole source of truth for "is this paired."

-- ── 1. self_register_doubles ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION self_register_doubles(
  p_tournament_id  uuid,
  p_division_id    uuid,
  p_user_id        uuid,
  p_partner_email  text,
  p_team_name      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_div         tournament_divisions%ROWTYPE;
  v_team_count  integer;
  v_solo_count  integer;
  v_effective   integer;
  v_status      text;
  v_reg_id      uuid;
  v_invitee_id  uuid;
  v_inv_id      uuid;
  v_inv_token   text;
BEGIN
  -- Lock division row to serialize concurrent registrations
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

  -- Scope guard: free divisions only — paid captain path uses a different route
  IF v_div.cost_cents IS NOT NULL AND v_div.cost_cents > 0 THEN
    RAISE EXCEPTION 'paid_division_use_other_path';
  END IF;

  -- Doubles format check
  IF v_div.format NOT IN (
    'mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles', 'open_doubles'
  ) THEN
    RAISE EXCEPTION 'not_doubles_format';
  END IF;

  -- Duplicate check
  IF EXISTS (
    SELECT 1 FROM tournament_registrations
     WHERE division_id = p_division_id
       AND user_id = p_user_id
       AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- Capacity: effective-teams logic mirrors register/route.ts
  SELECT
    COUNT(*) FILTER (WHERE registration_type = 'team'),
    COUNT(*) FILTER (WHERE registration_type = 'solo')
  INTO v_team_count, v_solo_count
    FROM tournament_registrations
   WHERE division_id = p_division_id
     AND status = 'registered'
     AND payment_status IN ('paid', 'waived', 'comped');

  v_effective := v_team_count + (v_solo_count / 2); -- integer division = floor

  IF v_effective >= v_div.max_entries THEN
    IF NOT COALESCE(v_div.waitlist_enabled, false) THEN
      RAISE EXCEPTION 'division_full';
    END IF;
    v_status := 'waitlisted';
  ELSE
    v_status := 'registered';
  END IF;

  -- INSERT registration — payment_status always 'waived' for free divisions
  INSERT INTO tournament_registrations (
    tournament_id, division_id, user_id, team_name,
    status, registration_type, payment_status, checked_in
  ) VALUES (
    p_tournament_id, p_division_id, p_user_id, p_team_name,
    v_status, 'team', 'waived', false
  ) RETURNING id INTO v_reg_id;

  -- Partner lookup: exact match only; NULL if no account (both branches explicit)
  -- v_invitee_id stays NULL when partner has no account — invite is still created for email-only accept
  SELECT id INTO v_invitee_id
    FROM profiles
   WHERE email = lower(p_partner_email);

  -- INSERT invitation — if this fails Postgres rolls back the registration INSERT above
  INSERT INTO tournament_team_invitations (
    tournament_id, division_id, inviter_registration_id,
    invitee_email, invitee_user_id
  ) VALUES (
    p_tournament_id, p_division_id, v_reg_id,
    lower(p_partner_email), v_invitee_id
  ) RETURNING id, token INTO v_inv_id, v_inv_token;

  RETURN jsonb_build_object(
    'reg_id',           v_reg_id,
    'invitation_id',    v_inv_id,
    'invitation_token', v_inv_token,
    'status',           v_status
  );
END;
$$;


-- ── 2. accept_free_partner_invite ───────────────────────────────────────────────────
--
-- Fixes the free-accept stuck-state bug in invite/[token]/route.ts:
--   OLD: invite flipped to 'accepted' BEFORE registration INSERT — if INSERT failed,
--        invitation was stuck 'accepted' with no registration row and no retry path.
--   NEW: UPDATE invite + INSERT registration in one transaction — either both commit
--        or both roll back. Invitation stays 'pending' on any failure, so partner can retry.

CREATE OR REPLACE FUNCTION accept_free_partner_invite(
  p_token    text,
  p_user_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv          tournament_team_invitations%ROWTYPE;
  v_div_status   text;
  v_cost_cents   integer;
  v_max_entries  integer;
  v_waitlist_en  boolean;
  v_slot_count   integer;
  v_status       text;
  v_reg_id       uuid;
  v_inviter_uid  uuid;
BEGIN
  -- Atomic claim: only one concurrent request wins this UPDATE (double-accept guard).
  -- Also transitions invitation to 'accepted' — rolls back if anything below fails.
  UPDATE tournament_team_invitations
     SET status = 'accepted', invitee_user_id = p_user_id
   WHERE token = p_token
     AND status = 'pending'
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_claimable';
  END IF;

  -- Fetch division state
  SELECT status, cost_cents, max_entries, waitlist_enabled
    INTO v_div_status, v_cost_cents, v_max_entries, v_waitlist_en
    FROM tournament_divisions
   WHERE id = v_inv.division_id;

  IF v_div_status = 'closed' THEN
    RAISE EXCEPTION 'division_closed';
  END IF;

  -- Scope guard: free only (paid partner accept goes through Stripe → webhook)
  IF v_cost_cents IS NOT NULL AND v_cost_cents > 0 THEN
    RAISE EXCEPTION 'paid_division_use_other_path';
  END IF;

  -- Duplicate check for invitee
  IF EXISTS (
    SELECT 1 FROM tournament_registrations
     WHERE division_id = v_inv.division_id
       AND user_id = p_user_id
       AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- Capacity: flat count — consistent with existing accept route behavior
  SELECT COUNT(*) INTO v_slot_count
    FROM tournament_registrations
   WHERE division_id = v_inv.division_id
     AND status = 'registered'
     AND payment_status IN ('paid', 'waived', 'comped');

  IF v_slot_count >= v_max_entries THEN
    IF NOT COALESCE(v_waitlist_en, false) THEN
      RAISE EXCEPTION 'division_full';
    END IF;
    v_status := 'waitlisted';
  ELSE
    v_status := 'registered';
  END IF;

  -- Verify inviter still active — rolls back invite claim if they cancelled
  SELECT user_id INTO v_inviter_uid
    FROM tournament_registrations
   WHERE id = v_inv.inviter_registration_id
     AND status <> 'cancelled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inviter_registration_gone';
  END IF;

  -- INSERT partner registration — failure rolls back invite claim above
  INSERT INTO tournament_registrations (
    tournament_id, division_id, user_id,
    status, registration_type, payment_status, checked_in
  ) VALUES (
    v_inv.tournament_id, v_inv.division_id, p_user_id,
    v_status, 'team', 'waived', false
  ) RETURNING id INTO v_reg_id;

  -- Cross-link: partner_user_id only (partner_registration_id is a dead column)
  UPDATE tournament_registrations
     SET partner_user_id = p_user_id
   WHERE id = v_inv.inviter_registration_id;

  UPDATE tournament_registrations
     SET partner_user_id = v_inviter_uid
   WHERE id = v_reg_id;

  RETURN jsonb_build_object(
    'reg_id',        v_reg_id,
    'tournament_id', v_inv.tournament_id,
    'status',        v_status
  );
END;
$$;

-- audit_log: server-side trail of every state-changing action on
-- entities that matter (matches, registrations, divisions, payments, etc).
--
-- V1 scope: schema + RLS only. Writes happen via the service-role helper
-- in lib/audit/log.ts. Reads are tightly locked: nobody can SELECT from
-- the frontend. Future PRs will add an organizer-visible audit view via
-- an RPC that filters by entity ownership.
--
-- Schema mirrors @docs/architecture-target.md (Phase B "competitions"
-- design), so when the unified schema lands this table moves over
-- untouched.

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL,
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per @docs/architecture-target.md "Required indexes": entity timeline lookups.
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, entity_id, created_at DESC);

-- Actor timeline lookups (rarer but useful for "what did this organizer
-- do today").
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_id, created_at DESC);

-- Lock the table down. Service-role bypasses RLS for the helper's writes.
-- Frontend code never reads or writes this table directly.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- No SELECT / INSERT / UPDATE / DELETE policies are added. With RLS
-- enabled and no policies, the anon and authenticated roles see nothing
-- and can write nothing — exactly the intent.

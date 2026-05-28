/**
 * Audit log writer. Server-side only — uses the Supabase service-role
 * client so writes bypass RLS (the audit_log table has RLS enabled with
 * no policies, so anon/authenticated roles can't read or write directly).
 *
 * Failures are intentionally non-blocking: if an audit insert fails, the
 * caller's primary operation should still complete and the failure is
 * surfaced via console.error. Audit logging must never be the reason a
 * user-facing action fails.
 *
 * Schema lives in supabase/migrations/20260528000002_audit_log.sql and
 * mirrors @docs/architecture-target.md for forward-compat with the
 * unified competitions schema.
 */

import { createClient as createServiceClient } from '@supabase/supabase-js'

// Canonical entity types. New ones can be added as audit coverage expands;
// keeping them centralised here lets us grep for "what gets audited."
export type AuditEntityType =
  | 'tournament'
  | 'tournament_division'
  | 'tournament_match'
  | 'tournament_registration'
  | 'tournament_staff'
  | 'league'
  | 'league_session'
  | 'league_match'
  | 'league_registration'
  | 'payment'

// Action verbs are free-form text — keep them in past tense and snake_case.
// Examples: 'score_updated', 'match_marked_ready', 'registration_refunded'.
export type AuditAction = string

export type AuditEntry = {
  actorId: string | null               // null for system / cron / webhook-only actions
  entityType: AuditEntityType
  entityId: string
  action: AuditAction
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

/**
 * Write one audit entry. Returns Promise<void>; never throws.
 *
 * Callers should `await logAudit(...)` so the insert lands before the
 * function returns, but don't need to handle errors — they're logged to
 * stderr and swallowed. If the audit table is unreachable, the calling
 * route still succeeds.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    // Fresh client per call matches the pattern used by every other API
    // route. Cheap enough at the volume audit logging happens at.
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error } = await service.from('audit_log').insert({
      actor_id:    entry.actorId,
      entity_type: entry.entityType,
      entity_id:   entry.entityId,
      action:      entry.action,
      before:      entry.before ?? null,
      after:       entry.after ?? null,
    })
    if (error) {
      // Don't throw — audit failure must not break the caller's primary op.
      console.error('[audit] write failed:', { entry, error: error.message })
    }
  } catch (err) {
    console.error('[audit] write threw:', { entry, err })
  }
}

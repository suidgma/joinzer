import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

// ── Reusable realtime channel manager ────────────────────────────────────────
// Owns every Supabase Realtime channel for the tab over ONE shared socket, with
// refcounting so N components that want the same topic share a single channel (the
// previous per-component `supabase.channel()` pattern opened a socket each). The
// topic string fully determines the channel's bindings, so all subscribers to a
// topic get the same stream; payloads fan out to every registered listener.

export type PgChangeConfig = {
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'
  schema?: string
  table: string
  filter?: string
}

export type ChannelSpec = {
  /** Stable identity for the channel. Same topic ⇒ same bindings ⇒ shared channel. */
  topic: string
  /** Postgres-changes bindings (client-readable tables only — RLS applies). */
  postgresChanges?: PgChangeConfig[]
  /** Broadcast event names to listen for (used for deny-all tables via server broadcast). */
  broadcast?: string[]
}

export type ChannelStatus = 'connecting' | 'subscribed' | 'error' | 'closed'

export type RealtimeEvent =
  | { kind: 'postgres_changes'; payload: RealtimePgPayload }
  | { kind: 'broadcast'; event: string; payload: Record<string, unknown> }
  | { kind: 'status'; status: ChannelStatus }

export type RealtimePgPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, any>
  old: Record<string, any>
}

type Listener = (evt: RealtimeEvent) => void

type Entry = {
  channel: RealtimeChannel
  listeners: Set<Listener>
  status: ChannelStatus
  refCount: number
}

export class ChannelManager {
  private entries = new Map<string, Entry>()

  constructor(
    private client: SupabaseClient,
    /** Called whenever any channel's status changes or a channel is torn down. */
    private onStatusChange?: () => void,
  ) {}

  subscribe(spec: ChannelSpec, listener: Listener): () => void {
    let entry = this.entries.get(spec.topic)
    if (!entry) {
      entry = this.create(spec)
      this.entries.set(spec.topic, entry)
    }
    entry.listeners.add(listener)
    entry.refCount += 1
    // Give the new listener the channel's current status right away.
    listener({ kind: 'status', status: entry.status })
    return () => this.release(spec.topic, listener)
  }

  /** Current status of every live channel — used to derive the global indicator. */
  statuses(): ChannelStatus[] {
    return [...this.entries.values()].map((e) => e.status)
  }

  private create(spec: ChannelSpec): Entry {
    const channel = this.client.channel(spec.topic, { config: { broadcast: { self: false } } })
    const entry: Entry = { channel, listeners: new Set(), status: 'connecting', refCount: 0 }

    for (const pg of spec.postgresChanges ?? []) {
      channel.on(
        'postgres_changes' as any,
        { event: pg.event ?? '*', schema: pg.schema ?? 'public', table: pg.table, ...(pg.filter ? { filter: pg.filter } : {}) },
        (payload: any) => {
          const evt: RealtimeEvent = { kind: 'postgres_changes', payload }
          entry.listeners.forEach((l) => l(evt))
        },
      )
    }
    for (const ev of spec.broadcast ?? []) {
      channel.on('broadcast', { event: ev }, (msg: any) => {
        const evt: RealtimeEvent = { kind: 'broadcast', event: ev, payload: msg?.payload ?? {} }
        entry.listeners.forEach((l) => l(evt))
      })
    }

    channel.subscribe((status) => {
      const mapped: ChannelStatus =
        status === 'SUBSCRIBED' ? 'subscribed'
        : status === 'CLOSED' ? 'closed'
        : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error'
        : 'connecting'
      entry.status = mapped
      entry.listeners.forEach((l) => l({ kind: 'status', status: mapped }))
      this.onStatusChange?.()
    })

    return entry
  }

  private release(topic: string, listener: Listener) {
    const entry = this.entries.get(topic)
    if (!entry) return
    entry.listeners.delete(listener)
    entry.refCount -= 1
    if (entry.refCount <= 0) {
      this.client.removeChannel(entry.channel)
      this.entries.delete(topic)
      this.onStatusChange?.()
    }
  }
}

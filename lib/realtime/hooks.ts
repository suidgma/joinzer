'use client'

import { useEffect, useRef, useState } from 'react'
import { useRealtimeContext, type ConnectionStatus } from './RealtimeProvider'
import type { ChannelSpec, ChannelStatus, RealtimeEvent } from './channelManager'

// The tab-wide connection status, for the live indicator.
export function useConnectionStatus(): ConnectionStatus {
  return useRealtimeContext().connection
}

// Low-level building block: subscribe to a channel spec and receive every realtime
// event (postgres_changes / broadcast / status). Returns this channel's own status so
// callers can react to reconnects. Re-subscribes only when the topic identity changes;
// the handler is kept fresh via a ref so passing a new closure each render is cheap.
export function useRealtimeChannel(
  spec: ChannelSpec | null,
  onEvent: (evt: RealtimeEvent) => void,
): ChannelStatus {
  const { subscribe } = useRealtimeContext()
  const [status, setStatus] = useState<ChannelStatus>('connecting')

  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const specRef = useRef(spec)
  specRef.current = spec

  const topic = spec?.topic ?? null

  useEffect(() => {
    const current = specRef.current
    if (!current) return
    const unsubscribe = subscribe(current, (evt) => {
      if (evt.kind === 'status') setStatus(evt.status)
      onEventRef.current(evt)
    })
    return unsubscribe
    // Topic fully determines the spec, so re-subscribe on topic change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, subscribe])

  return status
}

'use client'

import { useRealtimeChannel } from './hooks'
import { attendanceTopic, RealtimeEvents } from './topics'
import type { ChannelStatus } from './channelManager'

// A single attendance change, broadcast by the write route that authorized it. Carries
// only non-PII keys so the deny-all attendance tables never need a client SELECT policy.
export type AttendanceChange = {
  status: string
  registrationId?: string | null
  attendanceId?: string | null
  userId?: string | null
}

// Subscribe to live attendance changes for one occasion (a league session, or a
// box/ladder period). The consumer patches its own state by whichever key it holds
// (userId for the round-robin "who's coming" list, registrationId/attendanceId for the
// organizer grid). See lib/realtime/serverBroadcast.ts for the emitting side.
export function useAttendanceBroadcast(
  occasionId: string | null,
  onChange: (change: AttendanceChange) => void,
): ChannelStatus {
  return useRealtimeChannel(
    occasionId ? { topic: attendanceTopic(occasionId), broadcast: [RealtimeEvents.attendanceStatusChanged] } : null,
    (evt) => {
      if (evt.kind === 'broadcast') onChange(evt.payload as AttendanceChange)
    },
  )
}

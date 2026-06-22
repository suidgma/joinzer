import { createClient as createServiceClient } from '@supabase/supabase-js'

// The dates a schedule block may legitimately fall on: day one (start_date) plus
// any additional_days. Used to reject (API) and flag (UI) blocks scheduled
// outside the event window. Returns null if the tournament has no start_date.
export async function tournamentValidDates(tournamentId: string): Promise<string[] | null> {
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data } = await db
    .from('tournaments')
    .select('start_date, additional_days')
    .eq('id', tournamentId)
    .single()
  if (!data?.start_date) return null
  const extra = ((data.additional_days ?? []) as { date?: string }[])
    .map(d => d?.date)
    .filter((d): d is string => typeof d === 'string' && d !== '')
  return [data.start_date as string, ...extra]
}

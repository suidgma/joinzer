import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CreateLeagueForm from './CreateLeagueForm'
import DesktopShell from '@/components/ui/desktop-shell'
import WizardOutline from '@/components/ui/wizard-outline'
import type { LocationOption } from '@/lib/types'
import type { WizardStep } from '@/components/ui/wizard-outline'

const STEPS: WizardStep[] = [
  { id: 'basics',       label: 'Basics',         status: 'current'  },
  { id: 'schedule',     label: 'Schedule',        status: 'upcoming' },
  { id: 'format',       label: 'Format & rules',  status: 'upcoming' },
  { id: 'registration', label: 'Registration',    status: 'upcoming' },
]

export default async function CreateLeaguePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea, address, city, state, zip_code, country, lat, lng, short_code')
    .eq('is_active', true)
    .or(`status.eq.approved,created_by.eq.${user.id}`) // approved venues + your own pending ones
    .order('sort_order', { ascending: true })

  const locations = (data ?? []) as LocationOption[]

  let canCreatePaid = false
  if (user) {
    const { data: prof } = await supabase.from('profiles').select('can_create_paid_events').eq('id', user.id).single()
    canCreatePaid = !!prof?.can_create_paid_events
  }

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href="/leagues" className="text-brand-muted text-sm">← Leagues</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Create League</span>
        </div>
      }
      rail={<WizardOutline steps={STEPS} title="Create League" />}
    >
      <CreateLeagueForm locations={locations} canCreatePaid={canCreatePaid} />
    </DesktopShell>
  )
}

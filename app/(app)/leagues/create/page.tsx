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
    .select('id, name, court_count, access_type, subarea')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const locations = (data ?? []) as LocationOption[]

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
      <CreateLeagueForm locations={locations} />
    </DesktopShell>
  )
}

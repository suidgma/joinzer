import type { Metadata } from 'next'
import LandingNav from '@/components/landing/LandingNav'
import OrganizerHero from '@/components/landing/OrganizerHero'
import OrganizersSection from '@/components/landing/OrganizersSection'
import OrganizerUseCases from '@/components/landing/OrganizerUseCases'
import OrganizerHowItWorks from '@/components/landing/OrganizerHowItWorks'
import OrganizerFinalCTA from '@/components/landing/OrganizerFinalCTA'
import LandingFooter from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Joinzer for Organizers — Run Leagues & Tournaments',
  description: 'Tools for running pickleball leagues, tournaments, clinics, and open play events in Las Vegas. Brackets, payments, registrations, and day-of management.',
}

const DEMO_MAILTO = 'mailto:support@joinzer.com?subject=Organizer%20Demo%20Request'

export default function OrganizersPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <main>
        <OrganizerHero />
        <OrganizersSection cta={{ href: DEMO_MAILTO, label: 'Request a Demo', isExternal: true }} />
        <OrganizerUseCases />
        <OrganizerHowItWorks />
        <OrganizerFinalCTA />
      </main>
      <LandingFooter />
    </div>
  )
}

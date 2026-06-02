import type { Metadata } from 'next'
import LandingNav from '@/components/landing/LandingNav'
import HeroSection from '@/components/landing/HeroSection'
import HowItWorks from '@/components/landing/HowItWorks'
import FeaturesSection from '@/components/landing/FeaturesSection'
import CompeteSection from '@/components/landing/CompeteSection'
import TrustSection from '@/components/landing/TrustSection'
import MidPageCTA from '@/components/landing/MidPageCTA'
import FinalCTA from '@/components/landing/FinalCTA'
import LandingFooter from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Joinzer for Players — Find Local Pickleball',
  description: 'Discover open sessions, join leagues, enter tournaments, and connect with pickleball players near you in Las Vegas.',
}

export default function PlayersLandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <main>
        <HeroSection />
        <HowItWorks />
        <FeaturesSection />
        <CompeteSection />
        <TrustSection />
        <MidPageCTA />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  )
}

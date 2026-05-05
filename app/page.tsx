import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LandingNav from '@/components/landing/LandingNav'
import HeroSection from '@/components/landing/HeroSection'
import HowItWorks from '@/components/landing/HowItWorks'
import FeaturesSection from '@/components/landing/FeaturesSection'
import TrustSection from '@/components/landing/TrustSection'
import MidPageCTA from '@/components/landing/MidPageCTA'
import FinalCTA from '@/components/landing/FinalCTA'
import LandingFooter from '@/components/landing/LandingFooter'
import CompeteSection from '@/components/landing/CompeteSection'

export default async function HomePage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string }
}) {
  // Supabase password reset emails land here with ?code= — forward to reset page
  if (searchParams.code) {
    redirect(`/reset-password?code=${searchParams.code}`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/home')

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

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
import OrganizersSection from '@/components/landing/OrganizersSection'

export default async function HomePage(
  props: {
    searchParams: Promise<{ code?: string; error?: string }>
  }
) {
  const searchParams = await props.searchParams;
  // A ?code= on the landing page means an OAuth / magic-link redirect fell back to
  // the Site URL (its redirectTo wasn't honored by the allowlist) instead of
  // hitting /auth/callback. Forward to the canonical callback handler, which
  // exchanges the code and routes the user correctly (stub → profile setup,
  // otherwise → home). Do NOT assume ?code= is a password reset — recovery emails
  // redirect straight to /reset-password and never pass through here.
  if (searchParams.code) {
    redirect(`/auth/callback?code=${searchParams.code}`)
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
        <OrganizersSection />
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

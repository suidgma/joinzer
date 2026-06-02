import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LandingNav from '@/components/landing/LandingNav'
import RoleSelectorSection from '@/components/landing/RoleSelectorSection'
import LandingFooter from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Joinzer — Las Vegas Pickleball',
  description: 'Find and join local pickleball sessions in Las Vegas, or run your own leagues and tournaments.',
}

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
    <div className="min-h-screen bg-white flex flex-col">
      <LandingNav />
      <main className="flex-1 flex">
        <RoleSelectorSection />
      </main>
      <LandingFooter />
    </div>
  )
}

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BottomNav from '@/components/features/BottomNav'
import DesktopNav from '@/components/features/DesktopNav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const pathname = headers().get('x-pathname') ?? ''

  // Skip profile check on setup page to avoid infinite redirect loop
  if (!pathname.includes('/profile/setup')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!profile) redirect('/profile/setup')
  }

  return (
    <div className="min-h-screen bg-brand-page pb-16 lg:pb-0">
      <header className="sticky top-0 z-20 bg-brand-surface border-b border-brand-border">
        <div className="max-w-7xl mx-auto px-4 h-14 relative flex items-center">
          {/* Logo — left-anchored */}
          <div className="flex items-center gap-2 shrink-0 z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="w-8 h-8 object-contain" />
            <span className="font-heading font-bold text-lg text-brand-dark tracking-tight">Joinzer</span>
          </div>
          {/* Nav — absolutely centered relative to the full header */}
          <div className="hidden lg:flex absolute inset-0 items-center justify-center pointer-events-none">
            <div className="pointer-events-auto">
              <DesktopNav />
            </div>
          </div>
        </div>
      </header>
      {children}
      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  )
}

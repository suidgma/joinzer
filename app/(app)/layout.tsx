import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BottomNav from '@/components/features/BottomNav'
import DesktopNav from '@/components/features/DesktopNav'
import NotificationBell from '@/components/features/NotificationBell'
import DialogProvider from '@/components/ui/DialogProvider'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import ConnectionIndicator from '@/components/ui/ConnectionIndicator'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const hdrs = await headers()
  const pathname = hdrs.get('x-pathname') ?? ''
  const search = hdrs.get('x-search') ?? ''

  // Skip profile check on setup page to avoid infinite redirect loop.
  // Stubs (is_stub=true) are treated the same as missing profiles — must complete setup.
  if (!pathname.includes('/profile/setup')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, is_stub')
      .eq('id', user.id)
      .single()

    if (!profile || profile.is_stub) {
      // Preserve where the user was headed (e.g. a partner-invite accept link
      // with ?token=) so they land there after completing setup instead of /home.
      const dest = pathname + search
      const setupUrl = dest && dest !== '/home'
        ? `/profile/setup?next=${encodeURIComponent(dest)}`
        : '/profile/setup'
      redirect(setupUrl)
    }
  }

  // The bottom padding reserves the 64px bottom-nav height plus the iOS home-indicator
  // inset, so the last bit of page content never hides behind the safe-area-padded nav.
  return (
    <DialogProvider>
    <RealtimeProvider>
    <div className="min-h-screen bg-brand-page pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
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
          {/* Realtime status + notification bell — right-anchored */}
          <div className="ml-auto shrink-0 z-10 flex items-center gap-3">
            <ConnectionIndicator />
            <NotificationBell />
          </div>
        </div>
      </header>
      {children}
      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
    </RealtimeProvider>
    </DialogProvider>
  )
}

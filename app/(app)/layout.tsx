import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BottomNav from '@/components/features/BottomNav'

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
    <div className="min-h-screen pb-16">
      {children}
      <BottomNav />
    </div>
  )
}

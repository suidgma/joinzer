import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProfileEditForm from '@/components/features/ProfileEditForm'

export default async function ProfileEditPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, phone, rating_source, dupr_rating, estimated_rating, notify_new_sessions')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/profile/setup')

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/profile" className="text-sm text-gray-500 hover:text-black">
        ← Back to profile
      </Link>
      <h1 className="text-xl font-bold">Edit Profile</h1>
      <ProfileEditForm profile={profile} />
    </main>
  )
}

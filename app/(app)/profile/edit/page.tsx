import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProfileEditForm from '@/components/features/ProfileEditForm'

export default async function ProfileEditPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: profile }, { data: locations }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, display_name, phone, gender, rating_source, dupr_rating, estimated_rating, notify_new_sessions, profile_photo_url, home_court_id, email_visibility, phone_visibility, bio, dominant_hand, preferred_side, preferred_formats')
      .eq('id', user.id)
      .single(),
    supabase
      .from('locations')
      .select('id, name')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true }),
  ])

  if (!profile) redirect('/profile/setup')

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/profile" className="text-sm text-gray-500 hover:text-black">
        ← Back to profile
      </Link>
      <h1 className="text-xl font-bold">Edit Profile</h1>
      <ProfileEditForm profile={profile} locations={locations ?? []} />
    </main>
  )
}

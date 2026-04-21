import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ProfilePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/profile/setup')

  const ratingDisplay =
    profile.rating_source === 'dupr_known'
      ? `DUPR ${profile.dupr_rating}`
      : profile.rating_source === 'estimated'
      ? `Estimated ${profile.estimated_rating}`
      : null

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Profile</h1>
        <Link href="/profile/edit" className="text-sm text-gray-500 underline underline-offset-2">
          Edit
        </Link>
      </div>

      <div className="space-y-4">
        <div className="border rounded-xl p-4 space-y-3">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Name</p>
            <p className="font-medium">{profile.name}</p>
          </div>

          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Email</p>
            <p className="text-sm text-gray-700">{profile.email ?? user.email}</p>
          </div>

          {profile.phone && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Phone</p>
              <p className="text-sm text-gray-700">{profile.phone}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Rating</p>
            <p className="text-sm text-gray-700">{ratingDisplay ?? 'Not set'}</p>
          </div>
        </div>

        <SignOutButton />
      </div>
    </main>
  )
}

function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="w-full border border-gray-200 rounded-lg py-2 text-sm text-gray-500 hover:bg-gray-50"
      >
        Sign out
      </button>
    </form>
  )
}

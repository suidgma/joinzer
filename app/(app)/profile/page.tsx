import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { joinzerRatingLabel } from '@/lib/utils/date'
import DeleteAccountButton from '@/components/features/DeleteAccountButton'

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
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Profile</h1>
        <Link href="/profile/edit" className="text-sm text-brand-active font-medium underline underline-offset-2">
          Edit
        </Link>
      </div>

      {profile.profile_photo_url && (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.profile_photo_url} alt="Profile photo" className="w-24 h-24 rounded-full object-cover border-2 border-brand-border" />
        </div>
      )}

      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Name</p>
          <p className="font-medium text-brand-dark">{profile.name}</p>
        </div>

        <div>
          <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Email</p>
          <p className="text-sm text-brand-body">{profile.email ?? user.email}</p>
        </div>

        {profile.phone && (
          <div>
            <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Phone</p>
            <p className="text-sm text-brand-body">{profile.phone}</p>
          </div>
        )}

        {profile.gender && (
          <div>
            <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Gender</p>
            <p className="text-sm text-brand-body">{profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Rating</p>
          <p className="text-sm text-brand-body">{ratingDisplay ?? 'Not set'}</p>
        </div>

        <div>
          <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Joinzer Level</p>
          <p className="text-sm text-brand-body">{joinzerRatingLabel(profile.joinzer_rating ?? 1000)}</p>
        </div>
      </div>

      <SignOutButton />
      <DeleteAccountButton />
    </main>
  )
}

function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="w-full bg-brand-surface border border-brand-border text-brand-muted rounded-xl py-2.5 text-sm font-medium hover:bg-brand-soft transition-colors"
      >
        Sign out
      </button>
    </form>
  )
}

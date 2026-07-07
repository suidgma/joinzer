import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { selfReportedLevel } from '@/lib/rating/levels'
import DeleteAccountButton from '@/components/features/DeleteAccountButton'
import RatingBadge from '@/components/features/RatingBadge'
import PushSubscribeButton from '@/components/features/PushSubscribeButton'

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

  // Player identity: Joinzer Level (provisional, from the self-report today) + honest
  // self-reported provenance. No Joinzer Score until a calculated engine exists (Phase 2+).
  const selfRating: number | null =
    profile.self_reported_rating ??
    (profile.rating_source === 'estimated' ? profile.estimated_rating : profile.rating_source === 'dupr_known' ? profile.dupr_rating : null)
  const selfScale: string | null =
    profile.self_reported_scale ??
    (profile.rating_source === 'dupr_known' ? 'dupr' : profile.rating_source === 'estimated' ? 'self' : null)
  const joinzerLevel = selfReportedLevel(selfRating)

  // Compute missing fields for completeness nudge
  const missing: string[] = []
  if (selfRating == null) missing.push('skill rating')
  if (!profile.gender) missing.push('gender')
  if (!profile.profile_photo_url) missing.push('profile photo')

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Profile</h1>
        <Link href="/profile/edit" className="text-sm text-brand-active font-medium underline underline-offset-2">
          Edit
        </Link>
      </div>

      {missing.length > 0 && (
        <Link
          href="/profile/edit"
          className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 hover:border-amber-300 transition-colors"
        >
          <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">Complete your profile</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Missing: {missing.join(', ')}. Skill rating helps you get matched to the right leagues and sessions.
            </p>
          </div>
          <span className="text-amber-400 text-sm flex-shrink-0 self-center">→</span>
        </Link>
      )}

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

        {profile.display_name && (
          <div>
            <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Display Name</p>
            <p className="font-medium text-brand-dark">{profile.display_name}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Email</p>
          <p className="text-sm text-brand-body">{profile.email ?? user.email}</p>
          <p className="text-xs text-brand-muted mt-0.5">Visible to: {visibilityLabel(profile.email_visibility)}</p>
        </div>

        {profile.phone && (
          <div>
            <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Phone</p>
            <p className="text-sm text-brand-body">{profile.phone}</p>
            <p className="text-xs text-brand-muted mt-0.5">Visible to: {visibilityLabel(profile.phone_visibility)}</p>
          </div>
        )}

        {profile.gender && (
          <div>
            <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Gender</p>
            <p className="text-sm text-brand-body">{profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Joinzer Level</p>
          <p className="text-base font-semibold text-brand-dark">{joinzerLevel}</p>
          <div className="flex items-center gap-2 mt-1">
            <RatingBadge
              selfReportedRating={selfRating}
              selfReportedScale={selfScale}
              duprRating={profile.dupr_rating}
              duprVerified={profile.dupr_verified}
              size="sm"
            />
            {selfRating == null && (
              <Link href="/profile/edit" className="text-xs text-brand-active font-medium underline underline-offset-2">Add your skill level</Link>
            )}
          </div>
          <p className="text-[11px] text-brand-muted mt-1.5">
            Your Joinzer Score is calculated from match results (coming soon). Until then this reflects your self-reported skill.
          </p>
        </div>
      </div>

      <Link
        href="/profile/payments"
        className="flex items-center justify-between w-full bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 hover:border-brand-active transition-colors"
      >
        <span className="text-sm font-medium text-brand-dark">Payment History</span>
        <span className="text-brand-muted text-sm">→</span>
      </Link>

      <Link
        href="/settings/payouts"
        className="flex items-center justify-between w-full bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 hover:border-brand-active transition-colors"
      >
        <span className="text-sm font-medium text-brand-dark">Payouts (Stripe Connect)</span>
        <span className="text-brand-muted text-sm">→</span>
      </Link>

      {/* Push notifications toggle */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl px-4 py-3">
        <PushSubscribeButton />
      </div>

      <SignOutButton />
      <DeleteAccountButton />
    </main>
  )
}

function visibilityLabel(tier: string | null): string {
  if (tier === 'captains') return 'Organizers & co-admins of your events'
  if (tier === 'all') return 'All signed-in players'
  return 'Only you'
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

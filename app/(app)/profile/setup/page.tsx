'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type RatingSource = 'dupr_known' | 'estimated' | 'skipped'

const labelClass = 'block text-sm font-medium text-brand-dark mb-1'
const inputClass = 'w-full input'

export default function ProfileSetupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ratingSource, setRatingSource] = useState<RatingSource | null>(null)
  const [duprRating, setDuprRating] = useState('')
  const [estimatedRating, setEstimatedRating] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Pre-fill name from Google OAuth metadata if available
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      const googleName = user?.user_metadata?.full_name as string | undefined
      if (googleName && !name) setName(googleName)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ratingSource) {
      setError('Please answer the rating question')
      return
    }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      name: name.trim(),
      email: user.email,
      phone: phone.trim() || null,
      rating_source: ratingSource,
      dupr_rating:
        ratingSource === 'dupr_known' && duprRating
          ? parseFloat(duprRating)
          : null,
      estimated_rating:
        ratingSource === 'estimated' && estimatedRating
          ? parseFloat(estimatedRating)
          : null,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/events')
  }

  const canSubmit = name.trim().length > 0 && ratingSource !== null && !loading

  return (
    <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Joinzer" className="w-20 h-20 object-contain mx-auto" />
          <h1 className="font-heading text-xl font-bold text-brand-dark">Set up your profile</h1>
          <p className="text-sm text-brand-muted">Just a few things before you find a session</p>
        </div>

        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="phone" className={labelClass}>
                Phone{' '}
                <span className="text-brand-muted font-normal">(optional)</span>
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="702-555-0100"
                className={inputClass}
              />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-brand-dark">
                Do you know your DUPR rating?
              </legend>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ratingSource"
                  value="dupr_known"
                  onChange={() => setRatingSource('dupr_known')}
                  className="accent-brand-active"
                />
                <span className="text-sm text-brand-body">Yes, I know my DUPR</span>
              </label>

              {ratingSource === 'dupr_known' && (
                <input
                  type="number"
                  step="0.01"
                  min="2"
                  max="6.5"
                  value={duprRating}
                  onChange={(e) => setDuprRating(e.target.value)}
                  placeholder="e.g. 3.72"
                  className="w-full input ml-6"
                />
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ratingSource"
                  value="estimated"
                  onChange={() => setRatingSource('estimated')}
                  className="accent-brand-active"
                />
                <span className="text-sm text-brand-body">No, I&apos;ll estimate</span>
              </label>

              {ratingSource === 'estimated' && (
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="6.5"
                  value={estimatedRating}
                  onChange={(e) => setEstimatedRating(e.target.value)}
                  placeholder="e.g. 3.5"
                  className="w-full input ml-6"
                />
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ratingSource"
                  value="skipped"
                  onChange={() => setRatingSource('skipped')}
                  className="accent-brand-active"
                />
                <span className="text-sm text-brand-body">Skip for now</span>
              </label>
            </fieldset>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-brand text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-hover active:bg-brand-active disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}

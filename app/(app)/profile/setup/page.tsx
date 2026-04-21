'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type RatingSource = 'dupr_known' | 'estimated' | 'skipped'

export default function ProfileSetupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ratingSource, setRatingSource] = useState<RatingSource | null>(null)
  const [duprRating, setDuprRating] = useState('')
  const [estimatedRating, setEstimatedRating] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-xl font-bold">Set up your profile</h1>
          <p className="text-sm text-gray-500 mt-1">
            Just a few things before you find a session
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              Phone{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="702-555-0100"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Do you know your DUPR rating?
            </legend>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ratingSource"
                value="dupr_known"
                onChange={() => setRatingSource('dupr_known')}
                className="accent-black"
              />
              <span className="text-sm">Yes, I know my DUPR</span>
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
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black ml-6"
              />
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ratingSource"
                value="estimated"
                onChange={() => setRatingSource('estimated')}
                className="accent-black"
              />
              <span className="text-sm">No, I&apos;ll estimate</span>
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
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black ml-6"
              />
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ratingSource"
                value="skipped"
                onChange={() => setRatingSource('skipped')}
                className="accent-black"
              />
              <span className="text-sm">Skip for now</span>
            </label>
          </fieldset>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-black text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  )
}

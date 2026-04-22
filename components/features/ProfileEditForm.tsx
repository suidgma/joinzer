'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type RatingSource = 'dupr_known' | 'estimated' | 'skipped'

type Profile = {
  id: string
  name: string
  phone: string | null
  rating_source: string | null
  dupr_rating: number | null
  estimated_rating: number | null
}

export default function ProfileEditForm({ profile }: { profile: Profile }) {
  const router = useRouter()
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [ratingSource, setRatingSource] = useState<RatingSource>(
    (profile.rating_source as RatingSource) ?? 'skipped'
  )
  const [duprRating, setDuprRating] = useState(
    profile.dupr_rating?.toString() ?? ''
  )
  const [estimatedRating, setEstimatedRating] = useState(
    profile.estimated_rating?.toString() ?? ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({
        name: name.trim(),
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
      .eq('id', profile.id)

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/profile')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Phone{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="702-555-0100"
          className="w-full input"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">DUPR rating</legend>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="ratingSource"
            value="dupr_known"
            checked={ratingSource === 'dupr_known'}
            onChange={() => setRatingSource('dupr_known')}
            className="accent-brand-active"
          />
          <span className="text-sm">I know my DUPR</span>
        </label>

        {ratingSource === 'dupr_known' && (
          <input
            type="number"
            step="0.01"
            min="2"
            max="8"
            value={duprRating}
            onChange={(e) => setDuprRating(e.target.value)}
            placeholder="e.g. 3.72"
            className="input ml-6"
          />
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="ratingSource"
            value="estimated"
            checked={ratingSource === 'estimated'}
            onChange={() => setRatingSource('estimated')}
            className="accent-brand-active"
          />
          <span className="text-sm">Estimated rating</span>
        </label>

        {ratingSource === 'estimated' && (
          <input
            type="number"
            step="0.1"
            min="2"
            max="8"
            value={estimatedRating}
            onChange={(e) => setEstimatedRating(e.target.value)}
            placeholder="e.g. 3.5"
            className="input ml-6"
          />
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="ratingSource"
            value="skipped"
            checked={ratingSource === 'skipped'}
            onChange={() => setRatingSource('skipped')}
            className="accent-brand-active"
          />
          <span className="text-sm">Prefer not to say</span>
        </label>
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full bg-brand text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-hover active:bg-brand-active disabled:opacity-50 transition-colors"
      >
        {loading ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}

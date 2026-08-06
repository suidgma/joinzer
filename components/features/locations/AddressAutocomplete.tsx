'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Address suggestions for the "add a venue" form, backed by the server-side Places proxy.
 *
 * WHAT THIS COMPONENT DOES NOT DO: it does not fill the address into read-only fields. Selecting a
 * suggestion pre-fills EDITABLE inputs the user reviews before submitting. That is what makes the
 * stored `address_source='organizer'` true (ADR-12 — a Places `formatted_address` is not a storable
 * source, but a person's own asserted address is). If this ever becomes a read-only display, the
 * provenance recorded on the row becomes a false claim.
 *
 * BILLING SHAPE, because it is not visible from the UI. One session token is minted per venue the
 * user is adding and sent with every keystroke AND the final details call, so Google bills one
 * session rather than one request per character. The token is discarded after a selection and a
 * fresh one is minted for the next search. Combined with the debounce and the 3-character minimum,
 * that is what keeps a typed address from being a per-keystroke meter. The server refuses a
 * request with no token, so this cannot be bypassed by a stale client.
 */

/** Matches MIN_QUERY_LENGTH in app/api/places/autocomplete/route.ts — below it the server returns
 *  an empty list without calling Google, so asking is pure latency. */
const MIN_QUERY_LENGTH = 3

/** Long enough that a normal typing burst is one request, short enough to feel live. */
const DEBOUNCE_MS = 250

export type PlaceSuggestion = { placeId: string; description: string }

export type ResolvedAddress = {
  place_id: string
  address: string
  city: string
  state: string
  zip_code: string
  country: string
}

export default function AddressAutocomplete({
  onResolved,
  disabled,
}: {
  onResolved: (address: ResolvedAddress) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionToken = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const inputId = useId()

  /** One token per search session; regenerated after each selection so the next venue is its own
   *  billable session. `randomUUID` needs a secure context, which every deployed page is. */
  const currentToken = useCallback(() => {
    if (!sessionToken.current) {
      sessionToken.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    return sessionToken.current
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setOpen(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: trimmed, sessionToken: currentToken() }),
        })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          // 429 is the daily cap. Anything else is a lookup that simply didn't work; either way the
          // user can still type the address by hand, so this never blocks the form.
          setError(json.error ?? null)
          setSuggestions([])
          setOpen(false)
          return
        }
        setError(null)
        setSuggestions(json.suggestions ?? [])
        setOpen((json.suggestions ?? []).length > 0)
        setActiveIndex(-1)
      } catch {
        if (!cancelled) {
          setSuggestions([])
          setOpen(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, currentToken])

  // Close on an outside click. The listbox is not a modal, so Escape (handled below) and this are
  // the two ways out.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function select(suggestion: PlaceSuggestion) {
    setOpen(false)
    setQuery(suggestion.description)
    setLoading(true)
    try {
      const res = await fetch('/api/places/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: suggestion.placeId, sessionToken: currentToken() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not load that address — please type it below.')
        return
      }
      setError(null)
      onResolved(json as ResolvedAddress)
    } catch {
      setError('Could not load that address — please type it below.')
    } finally {
      setLoading(false)
      // The session ends with the selection, billed or not. The next search starts a new one.
      sessionToken.current = null
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      // Only intercept Enter when a suggestion is highlighted, so Enter with nothing selected
      // still submits the surrounding form as the user expects.
      e.preventDefault()
      void select(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="block text-[11px] font-medium text-brand-muted mb-0.5">
        Find the address
      </label>
      <div className="relative">
        <input
          id={inputId}
          name="venue-address-search"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-describedby={`${inputId}-hint`}
          autoComplete="off"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Start typing an address…"
          className="input text-sm pr-9 touch-manipulation"
        />
        {loading && (
          <Loader2
            aria-hidden="true"
            className="w-4 h-4 animate-spin text-brand-muted absolute right-3 top-1/2 -translate-y-1/2 motion-reduce:animate-none"
          />
        )}
      </div>

      <p id={`${inputId}-hint`} className="mt-1 text-[11px] text-brand-muted">
        Pick a match to fill in the address below, or just type it in yourself.
      </p>

      {/* Politely announced so a screen-reader user learns results arrived without losing focus. */}
      <span aria-live="polite" className="sr-only">
        {open && suggestions.length > 0 ? `${suggestions.length} address suggestions` : ''}
      </span>

      {error && (
        <p className="mt-1 text-[11px] text-amber-700" role="status">
          {error}
        </p>
      )}

      <ul
        id={listboxId}
        role="listbox"
        aria-label="Address suggestions"
        hidden={!open || suggestions.length === 0}
        className="absolute z-20 left-0 right-0 mt-1 bg-white border border-brand-border rounded-xl shadow-lg overflow-hidden"
      >
        {suggestions.map((s, i) => (
          <li
            key={s.placeId}
            id={`${listboxId}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            // Pointer-down rather than click: the input's blur would otherwise close the list
            // before the click lands.
            onPointerDown={(e) => {
              e.preventDefault()
              void select(s)
            }}
            onPointerEnter={() => setActiveIndex(i)}
            className={`px-3 py-2.5 text-sm cursor-pointer touch-manipulation ${
              i === activeIndex ? 'bg-brand-soft text-brand-dark' : 'text-brand-body'
            }`}
          >
            {s.description}
          </li>
        ))}
      </ul>
    </div>
  )
}

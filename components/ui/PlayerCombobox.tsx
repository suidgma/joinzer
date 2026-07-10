'use client'

// Searchable single-select for picking a player by name. Replaces the native
// <select> used across add-player / add-sub surfaces so organizers can type to
// find someone instead of scrolling a long, capped dropdown. The results list is
// in normal flow (not absolutely positioned) so it grows its container — safe
// inside bottom-sheet modals where an absolute dropdown would overflow off-screen.

import { useEffect, useMemo, useRef, useState } from 'react'

export type PlayerOption = { id: string; name: string }

type Props = {
  options: PlayerOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  /** Shown when there are no options at all (as opposed to no search matches). */
  emptyText?: string
}

export default function PlayerCombobox({
  options,
  value,
  onChange,
  placeholder = 'Search by name…',
  disabled = false,
  autoFocus = false,
  className,
  emptyText = 'No players available',
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.name.toLowerCase().includes(q))
  }, [options, query])

  // Close and reset the query when clicking outside.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  // Keep the highlighted row in view as the user arrows through.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function choose(option: PlayerOption) {
    onChange(option.id)
    setQuery('')
    setOpen(false)
  }

  // Closed → show the selected name; open → show the live query.
  const inputValue = open ? query : selected?.name ?? ''

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        value={inputValue}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlight(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
          if (value) onChange('') // typing after a pick starts a fresh search
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.min(h + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            if (open && filtered[highlight]) {
              e.preventDefault()
              choose(filtered[highlight])
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
            setQuery('')
          }
        }}
        className="w-full input text-sm"
      />
      {open && !disabled && (
        <ul
          ref={listRef}
          className="mt-1 max-h-60 overflow-y-auto rounded-xl border border-brand-border bg-brand-surface divide-y divide-brand-border/60"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-brand-muted">{emptyText}</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-brand-muted">No players match “{query}”</li>
          ) : (
            filtered.map((option, i) => (
              <li key={option.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault() // select before the input's blur closes the list
                    choose(option)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-brand-soft ${
                    i === highlight ? 'bg-brand-soft' : ''
                  } ${option.id === value ? 'font-semibold text-brand-dark' : 'text-brand-body'}`}
                >
                  {option.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

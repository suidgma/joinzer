'use client'

import { useState, useRef, useEffect } from 'react'
import type { LocationOption } from '@/lib/types'

type Props = {
  locations: LocationOption[]
  value: string
  onChange: (id: string) => void
}

export default function LocationCombobox({ locations, value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = locations.find((l) => l.id === value)

  const filtered = query.trim()
    ? locations.filter((l) =>
        l.name.toLowerCase().includes(query.toLowerCase()) ||
        (l.subarea ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : locations

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(location: LocationOption) {
    onChange(location.id)
    setQuery('')
    setOpen(false)
  }

  const displayValue =
    selected && !open
      ? selected.name
      : query

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          if (!e.target.value) onChange('')
        }}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        placeholder="Search locations…"
        autoComplete="off"
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
      />

      {open && (
        <ul className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No locations found</li>
          ) : (
            filtered.map((location) => (
              <li key={location.id}>
                <button
                  type="button"
                  onMouseDown={() => handleSelect(location)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className="font-medium">{location.name}</span>
                  {location.subarea && (
                    <span className="text-gray-400"> · {location.subarea}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

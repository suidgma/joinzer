'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin } from 'lucide-react'
import type { LocationOption } from '@/lib/types'

// Leaflet touches `window`, so load the map client-only (never SSR it).
const LocationMapModal = dynamic(() => import('./LocationMapModal'), { ssr: false })

// "View on map" affordance for the location pickers — opens a map of every venue
// with coordinates and lets the organizer click a pin to select it.
export default function LocationMapButton({
  locations,
  value,
  onSelect,
}: {
  locations: LocationOption[]
  value: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasMappable = locations.some((l) => l.lat != null && l.lng != null)
  if (!hasMappable) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-brand-active hover:underline"
      >
        <MapPin className="w-3.5 h-3.5" /> View on map
      </button>
      {open && (
        <LocationMapModal
          locations={locations}
          value={value}
          onSelect={(id) => {
            onSelect(id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

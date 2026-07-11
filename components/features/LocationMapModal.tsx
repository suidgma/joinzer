'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet'
import type { LocationOption } from '@/lib/types'
import { venueCode } from '@/lib/locations/venueCode'

const VEGAS_CENTER: [number, number] = [36.1699, -115.1398]

// Fit the view to all the pins once the map mounts. The setTimeout lets the modal
// finish laying out first — invalidateSize avoids gray tiles when a map mounts
// inside a freshly-shown container, and it must run before fitBounds is measured.
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    const id = setTimeout(() => {
      map.invalidateSize()
      if (points.length === 1) map.setView(points[0], 14)
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30] })
    }, 0)
    return () => clearTimeout(id)
  }, [map, points])
  return null
}

function addressOf(l: LocationOption): string {
  return [l.address, l.city, l.state, l.zip_code].filter(Boolean).join(', ')
}

// Interactive picker: each venue with coordinates is a pin; click one to select it.
// Rendered client-only (Leaflet needs `window`) via a dynamic import in the button.
export default function LocationMapModal({
  locations,
  value,
  onSelect,
  onClose,
}: {
  locations: LocationOption[]
  value: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const withCoords = locations.filter((l) => l.lat != null && l.lng != null)
  const points = withCoords.map((l) => [l.lat as number, l.lng as number] as [number, number])
  const center = points[0] ?? VEGAS_CENTER

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl w-full max-w-2xl overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-brand-border">
          <h2 className="text-sm font-semibold text-brand-dark">Pick a location on the map</h2>
          <button type="button" onClick={onClose} className="text-brand-muted text-sm px-1" aria-label="Close">✕</button>
        </div>
        <div className="h-[60vh] w-full">
          <MapContainer center={center} zoom={11} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={points} />
            {withCoords.map((l) => {
              const selected = l.id === value
              const addr = addressOf(l)
              return (
                <CircleMarker
                  key={l.id}
                  center={[l.lat as number, l.lng as number]}
                  radius={selected ? 10 : 7}
                  pathOptions={{
                    color: selected ? '#012D0B' : '#3f5c14',
                    fillColor: '#8FC919',
                    fillOpacity: 0.9,
                    weight: 2,
                  }}
                >
                  <Tooltip permanent direction="right" offset={[6, 0]} className="venue-code-label">
                    {venueCode(l.name, l.short_code)}
                  </Tooltip>
                  <Popup>
                    <div className="space-y-1">
                      <p className="font-semibold text-sm text-brand-dark">{l.name}</p>
                      {addr && <p className="text-xs text-brand-muted">{addr}</p>}
                      <button
                        type="button"
                        onClick={() => onSelect(l.id)}
                        className="mt-1 text-xs font-semibold text-brand-active underline"
                      >
                        Select this location
                      </button>
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

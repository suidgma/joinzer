import type { LocationOption } from '@/lib/types'

// A venue the user typed in because it isn't in the directory yet.
export type NewLocationDraft = {
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  country: string
}

export const emptyLocationDraft = (): NewLocationDraft => ({
  name: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  country: 'US',
})

// Create the location server-side and return it as a LocationOption. Throws on failure.
export async function createLocation(draft: NewLocationDraft): Promise<LocationOption> {
  const res = await fetch('/api/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.location) throw new Error(json.error ?? 'Failed to create location')
  return json.location as LocationOption
}

'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Re-fetch the server component when the tab regains visibility, so a page left
// open while changes happen elsewhere (another tab, a cycle advance) resyncs
// instead of showing stale data. router.refresh() is a no-op re-render when
// nothing changed, so this is cheap and safe.
export default function RefreshOnVisible() {
  const router = useRouter()
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [router])
  return null
}

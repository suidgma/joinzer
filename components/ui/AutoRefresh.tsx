'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Keeps a server-rendered page fresh without a manual reload. Calls
// router.refresh() (re-fetches the RSC payload and reconciles in place — no full
// reload, preserves scroll and client state) whenever the tab regains focus /
// visibility, plus on a short interval when `intervalMs > 0` (pass 0 to poll only
// on focus). Cheap: interval ticks are skipped while the tab is hidden.
export default function AutoRefresh({ intervalMs = 0 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const id = intervalMs > 0 ? setInterval(refresh, intervalMs) : undefined
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      if (id) clearInterval(id)
    }
  }, [router, intervalMs])

  return null
}

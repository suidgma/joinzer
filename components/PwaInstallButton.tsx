'use client'
import { useEffect, useState } from 'react'

export default function PwaInstallButton() {
  const [prompt, setPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    // If already running as installed PWA, don't show the button
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (installed || !prompt) return null

  return (
    <div className="fixed bottom-20 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
      <button
        onClick={async () => {
          prompt.prompt()
          const { outcome } = await prompt.userChoice
          if (outcome === 'accepted') setInstalled(true)
          setPrompt(null)
        }}
        className="pointer-events-auto bg-brand-dark text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg flex items-center gap-2"
      >
        <span>📲</span> Install Joinzer App
      </button>
    </div>
  )
}

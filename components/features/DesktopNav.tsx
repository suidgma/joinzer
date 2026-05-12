'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/home',        label: 'Home' },
  { href: '/events',      label: 'Play' },
  { href: '/compete',     label: 'Leagues' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/players',     label: 'Players' },
  { href: '/profile',     label: 'Profile' },
]

export default function DesktopNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1">
      {tabs.map(tab => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-brand text-brand-dark'
                : 'text-brand-muted hover:text-brand-dark hover:bg-brand-soft'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

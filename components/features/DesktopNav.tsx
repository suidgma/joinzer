'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useChatUnread } from '@/lib/realtime/ChatUnreadProvider'

const tabs = [
  { href: '/home',        label: 'Home' },
  { href: '/play',      label: 'Play' },
  { href: '/leagues',     label: 'Leagues' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/players',     label: 'Players' },
  { href: '/profile',     label: 'Profile' },
]

export default function DesktopNav() {
  const pathname = usePathname()
  const unread = useChatUnread()

  return (
    <nav className="flex items-center gap-1">
      {tabs.map(tab => {
        // Match the full path segment so /players doesn't also light up /play.
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        const surface = tab.href === '/leagues' ? 'leagues' : tab.href === '/tournaments' ? 'tournaments' : null
        const showDot = !!surface && unread[surface] > 0
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-brand text-brand-dark'
                : 'text-brand-muted hover:text-brand-dark hover:bg-brand-soft'
            }`}
          >
            {tab.label}
            {showDot && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-brand-dark" aria-label="New messages" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}

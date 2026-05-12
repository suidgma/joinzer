'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface ManageNavItem {
  label: string
  href: string
}

interface ManageNavProps {
  items: ManageNavItem[]
  mobileOnly?: boolean
}

/**
 * Navigation for manage views (/tournaments/[id], /leagues/[id]).
 * Desktop: sticky vertical sidebar links.
 * Mobile: horizontally scrollable tab bar pinned below the page header.
 * Active state is derived from the current pathname.
 */
export default function ManageNav({ items, mobileOnly = false }: ManageNavProps) {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile: scrollable tab bar */}
      <nav
        className="lg:hidden flex overflow-x-auto border-b border-gray-200 bg-white"
        aria-label="Manage navigation"
      >
        {items.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                active
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Desktop: sticky vertical sidebar */}
      {!mobileOnly && (
        <nav className="hidden lg:block sticky top-6" aria-label="Manage navigation">
          <div className="space-y-0.5">
            {items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center px-3 py-2 rounded-md text-sm transition-colors ${
                    active
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>
      )}
    </>
  )
}

'use client'

import { useState, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface FormSectionProps {
  title: string
  description?: string
  children: ReactNode
  /** Whether the mobile accordion starts open. Default: true. */
  defaultOpen?: boolean
}

/**
 * Groups related FormRow instances under a heading.
 * Desktop: card with always-visible header.
 * Mobile: accordion — title is the toggle trigger.
 */
export default function FormSection({
  title,
  description,
  children,
  defaultOpen = true,
}: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Desktop header — always visible */}
      <div className="hidden lg:block px-6 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        )}
      </div>

      {/* Mobile accordion trigger */}
      <button
        type="button"
        className="lg:hidden w-full flex items-center justify-between px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Body: always visible desktop, toggled mobile */}
      <div className={`${open ? 'block' : 'hidden'} lg:block px-4 lg:px-6 py-2 lg:py-4`}>
        {children}
      </div>
    </div>
  )
}

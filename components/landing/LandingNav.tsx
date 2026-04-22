'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export default function LandingNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/logo.png" alt="Joinzer" width={32} height={32} className="object-contain" />
            <span className="font-heading font-bold text-brand-dark text-lg">Joinzer</span>
          </Link>

          {/* Center nav links */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">How It Works</a>
            <Link href="/events" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Find Games</Link>
            <a href="#community" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Courts</a>
            <a href="#about" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">About</a>
          </nav>

          {/* Right buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-brand-dark px-4 py-2 rounded-xl border border-brand-border hover:bg-brand-soft transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/login"
              className="text-sm font-semibold bg-brand text-brand-dark px-4 py-2 rounded-xl hover:bg-brand-hover transition-colors"
            >
              Create Free Account
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 text-brand-muted hover:text-brand-dark"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              {open ? (
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
          <a href="#how-it-works" onClick={() => setOpen(false)} className="block text-sm text-brand-muted py-2">How It Works</a>
          <Link href="/events" onClick={() => setOpen(false)} className="block text-sm text-brand-muted py-2">Find Games</Link>
          <a href="#community" onClick={() => setOpen(false)} className="block text-sm text-brand-muted py-2">Courts</a>
          <a href="#about" onClick={() => setOpen(false)} className="block text-sm text-brand-muted py-2">About</a>
          <div className="pt-2 space-y-2">
            <Link href="/login" className="block w-full text-center text-sm font-medium text-brand-dark border border-brand-border py-2.5 rounded-xl hover:bg-brand-soft transition-colors">Sign In</Link>
            <Link href="/login" className="block w-full text-center text-sm font-semibold bg-brand text-brand-dark py-2.5 rounded-xl hover:bg-brand-hover transition-colors">Create Free Account</Link>
          </div>
        </div>
      )}
    </header>
  )
}

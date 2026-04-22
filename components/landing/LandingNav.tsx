'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'

export default function LandingNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-brand-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="Joinzer" width={36} height={36} className="object-contain" />
          <span className="font-heading font-bold text-xl text-brand-dark tracking-tight">Joinzer</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          <a href="#how-it-works" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">How it works</a>
          <a href="#features" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Features</a>
          <Link
            href="/login"
            className="text-sm text-brand-dark font-medium hover:text-brand-active transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="bg-brand text-brand-dark text-sm font-semibold px-4 py-2 rounded-xl hover:bg-brand-hover transition-colors"
          >
            Get started free
          </Link>
        </nav>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-brand-dark p-1"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-white border-t border-brand-border px-4 py-4 space-y-3">
          <a href="#how-it-works" onClick={() => setOpen(false)} className="block text-sm text-brand-muted py-1">How it works</a>
          <a href="#features" onClick={() => setOpen(false)} className="block text-sm text-brand-muted py-1">Features</a>
          <Link href="/login" onClick={() => setOpen(false)} className="block text-sm text-brand-dark font-medium py-1">Sign in</Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="block w-full bg-brand text-brand-dark text-sm font-semibold px-4 py-2.5 rounded-xl text-center hover:bg-brand-hover transition-colors"
          >
            Get started free
          </Link>
        </div>
      )}
    </header>
  )
}

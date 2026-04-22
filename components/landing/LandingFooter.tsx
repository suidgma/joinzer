import Link from 'next/link'
import Image from 'next/image'

export default function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer id="about" className="bg-white border-t border-brand-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        {/* Top grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand — full width on mobile */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-3">
              <Image src="/logo.png" alt="Joinzer" width={26} height={26} className="object-contain" />
              <span className="font-heading font-bold text-brand-dark">Joinzer</span>
            </Link>
            <p className="text-sm text-brand-muted leading-relaxed">
              Find and join local pickleball sessions.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-xs font-semibold text-brand-dark uppercase tracking-widest mb-4">Product</h4>
            <ul className="space-y-3">
              <li><a href="#how-it-works" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">How It Works</a></li>
              <li><Link href="/events" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Find Games</Link></li>
              <li><a href="#community" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Courts</a></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-semibold text-brand-dark uppercase tracking-widest mb-4">Company</h4>
            <ul className="space-y-3">
              <li><Link href="/about" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">About</Link></li>
              <li><Link href="/contact" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Contact</Link></li>
            </ul>
          </div>

          {/* Account */}
          <div>
            <h4 className="text-xs font-semibold text-brand-dark uppercase tracking-widest mb-4">Account</h4>
            <ul className="space-y-3">
              <li><Link href="/login" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Sign In</Link></li>
              <li><Link href="/login" className="text-sm text-brand-muted hover:text-brand-dark transition-colors">Create Account</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="pt-6 border-t border-brand-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-brand-muted">© {year} Joinzer. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/terms" className="text-xs text-brand-muted hover:text-brand-dark transition-colors">Terms</Link>
            <Link href="/privacy" className="text-xs text-brand-muted hover:text-brand-dark transition-colors">Privacy</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

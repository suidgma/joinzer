import Link from 'next/link'
import Image from 'next/image'

export default function LandingFooter() {
  return (
    <footer className="bg-white border-t border-brand-border">
      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </div>

        <div className="flex items-center gap-6 text-sm text-brand-muted">
          <Link href="/login" className="hover:text-brand-dark transition-colors">Sign in</Link>
          <Link href="/login" className="hover:text-brand-dark transition-colors">Create account</Link>
          <span className="text-brand-border">·</span>
          <span>Terms</span>
          <span>Privacy</span>
        </div>

        <p className="text-xs text-brand-muted">
          © {new Date().getFullYear()} Joinzer. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

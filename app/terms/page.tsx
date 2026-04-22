import Link from 'next/link'
import Image from 'next/image'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-extrabold text-brand-dark mb-2">Terms of Service</h1>
        <p className="text-brand-muted text-sm mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-brand-body text-sm leading-relaxed">
          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">1. Acceptance of Terms</h2>
            <p>By using Joinzer, you agree to these terms. If you do not agree, do not use the service.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">2. Use of Service</h2>
            <p>Joinzer is a platform for organizing and joining local pickleball sessions. You agree to use it only for lawful purposes and in a manner that does not infringe the rights of others.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">3. Accounts</h2>
            <p>You are responsible for maintaining the security of your account. You must provide accurate information when creating an account.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">4. User Content</h2>
            <p>You retain ownership of content you post. By posting, you grant Joinzer a license to display that content on the platform.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">5. Disclaimer</h2>
            <p>Joinzer is provided &quot;as is&quot; without warranties of any kind. We are not responsible for the conduct of users or the safety of any in-person events organized through the platform.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">6. Changes</h2>
            <p>We may update these terms at any time. Continued use of Joinzer after changes constitutes acceptance of the new terms.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">7. Contact</h2>
            <p>Questions about these terms? Email us at <a href="mailto:support@joinzer.com" className="text-brand-active hover:underline">support@joinzer.com</a>.</p>
          </section>
        </div>

        <div className="mt-10">
          <Link href="/" className="inline-block bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl text-sm hover:bg-brand-hover transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

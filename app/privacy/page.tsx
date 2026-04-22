import Link from 'next/link'
import Image from 'next/image'

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-extrabold text-brand-dark mb-2">Privacy Policy</h1>
        <p className="text-brand-muted text-sm mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-brand-body text-sm leading-relaxed">
          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">What we collect</h2>
            <p>We collect information you provide when creating an account (name, email, optional phone and DUPR rating) and information about your activity on the platform (sessions joined, messages sent).</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">How we use it</h2>
            <p>We use your information to operate the Joinzer platform — showing your name to other participants, enabling session coordination, and improving the product. We do not sell your data.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">Data storage</h2>
            <p>Your data is stored securely using Supabase (PostgreSQL). Authentication is handled by Supabase Auth. We follow industry-standard security practices.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">Third parties</h2>
            <p>We use Supabase for database and authentication, and Vercel for hosting. If you sign in with Google, Google&apos;s OAuth is used and subject to Google&apos;s privacy policy.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">Your rights</h2>
            <p>You can request deletion of your account and data at any time by emailing us at <a href="mailto:support@joinzer.com" className="text-brand-active hover:underline">support@joinzer.com</a>.</p>
          </section>

          <section>
            <h2 className="font-heading font-bold text-brand-dark text-base mb-3">Contact</h2>
            <p>Privacy questions? Email <a href="mailto:support@joinzer.com" className="text-brand-active hover:underline">support@joinzer.com</a>.</p>
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

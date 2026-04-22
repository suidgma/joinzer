import Link from 'next/link'
import Image from 'next/image'

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-extrabold text-brand-dark mb-4">Contact</h1>
        <p className="text-brand-muted text-base mb-8">
          Have a question, feedback, or issue? We&apos;d love to hear from you.
        </p>

        <div className="bg-brand-page border border-brand-border rounded-2xl p-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-brand-dark mb-1">Email us</p>
            <a
              href="mailto:support@joinzer.com"
              className="text-brand-active text-sm hover:underline"
            >
              support@joinzer.com
            </a>
          </div>
          <div>
            <p className="text-sm font-medium text-brand-dark mb-1">Response time</p>
            <p className="text-sm text-brand-muted">We typically respond within 1–2 business days.</p>
          </div>
        </div>

        <div className="mt-8">
          <Link
            href="/"
            className="inline-block bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl text-sm hover:bg-brand-hover transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

import Image from 'next/image'

const DEMO_MAILTO = 'mailto:support@joinzer.com?subject=Organizer%20Demo%20Request'

export default function OrganizerFinalCTA() {
  return (
    <section className="py-14 md:py-24 bg-brand-dark">
      <div className="max-w-2xl mx-auto px-4 text-center">
        {/* Restrained brand mark — mascot used lightly on the organizer page */}
        <div className="flex justify-center mb-6">
          <div className="relative w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
            <Image src="/logo.png" alt="Joinzer" width={40} height={40} className="object-contain" />
          </div>
        </div>

        <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-white mb-3">
          Ready to run your first event on Joinzer?
        </h2>

        <p className="text-white/70 text-sm sm:text-base max-w-md mx-auto mb-8">
          We&apos;re working with early organizers in Las Vegas. Request a demo and we&apos;ll walk you through the platform for your specific format.
        </p>

        <div className="flex justify-center">
          <a
            href={DEMO_MAILTO}
            className="w-full sm:w-auto bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm shadow-sm text-center"
          >
            Request a Demo
          </a>
        </div>
      </div>
    </section>
  )
}

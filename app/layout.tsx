import type { Metadata, Viewport } from 'next'
import { Inter, Manrope } from 'next/font/google'
import Script from 'next/script'
import { GoogleAnalytics } from '@next/third-parties/google'
import './globals.css'
import PwaInstallButton from '@/components/PwaInstallButton'
import { getSiteUrl } from '@/lib/utils/site-url'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' })

// Rendered only when the ID is configured: without the guard an unset env var would
// request gtag.js with `id=undefined` and fire `gtag('config','undefined')` on every page.
const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: 'Joinzer',
  description: 'Find and join local pickleball sessions in Las Vegas.',
  openGraph: {
    title: 'Joinzer',
    description: 'Find and join local pickleball sessions in Las Vegas.',
    images: ['/logo.png'],
  },
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Joinzer',
  },
}

// viewport-fit=cover lets the fixed bottom nav pad itself past the iOS home
// indicator via env(safe-area-inset-bottom); themeColor matches the brand header.
export const viewport: Viewport = {
  themeColor: '#012D0B',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${manrope.variable}`}>
      <body suppressHydrationWarning className="font-sans">
        <Script
          id="sw-register"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(console.error)}`
          }}
        />
        {/* Base GA4 install (page views only). Client-side route changes are covered by GA4
            Enhanced Measurement's browser-history events — App Router navigation is pushState —
            so a manual pageview on route change here would double-count. */}
        {gaMeasurementId ? <GoogleAnalytics gaId={gaMeasurementId} /> : null}
        <PwaInstallButton />
        {children}
      </body>
    </html>
  )
}

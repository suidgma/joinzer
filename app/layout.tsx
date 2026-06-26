import type { Metadata, Viewport } from 'next'
import { Inter, Manrope } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import PwaInstallButton from '@/components/PwaInstallButton'
import { getSiteUrl } from '@/lib/utils/site-url'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' })

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
        <PwaInstallButton />
        {children}
      </body>
    </html>
  )
}

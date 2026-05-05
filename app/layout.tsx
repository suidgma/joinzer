import type { Metadata } from 'next'
import { Inter, Manrope } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' })

export const metadata: Metadata = {
  title: 'Joinzer',
  description: 'Find and join local pickleball sessions in Las Vegas.',
  openGraph: {
    title: 'Joinzer',
    description: 'Find and join local pickleball sessions in Las Vegas.',
    images: ['/logo.png'],
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Joinzer',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${manrope.variable}`}>
      <body suppressHydrationWarning className="font-sans">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  )
}

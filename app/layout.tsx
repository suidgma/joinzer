import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Joinzer',
  description: 'Find and join local pickleball sessions',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}

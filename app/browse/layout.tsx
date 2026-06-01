import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'

export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <LandingNav />
      <div className="flex-1">
        {children}
      </div>
      <LandingFooter />
    </div>
  )
}

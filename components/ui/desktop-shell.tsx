import { ReactNode } from 'react'

interface DesktopShellProps {
  /** Breadcrumb + primary action bar rendered above the content grid */
  header?: ReactNode
  /** Left sidebar slot — ManageNav lives here. Collapses below lg. */
  sidebar?: ReactNode
  /** Right rail slot — WizardOutline lives here. Collapses below lg. */
  rail?: ReactNode
  children: ReactNode
}

/**
 * Layout shell for desktop-canonical organizer routes.
 * Sidebar and rail persist at lg (1024px+); both collapse below that.
 * Mobile callers should render ManageNav / WizardOutline in their own
 * mobile-specific positions (ManageNav handles this internally).
 */
export default function DesktopShell({
  header,
  sidebar,
  rail,
  children,
}: DesktopShellProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {header && (
          <div className="py-4 border-b border-gray-200 bg-gray-50">
            {header}
          </div>
        )}
        <div className="flex gap-6 py-6">
          {sidebar && (
            <aside className="hidden lg:block w-52 shrink-0">
              {sidebar}
            </aside>
          )}
          <main className="min-w-0 flex-1 space-y-4">
            {children}
          </main>
          {rail && (
            <aside className="hidden lg:block w-60 shrink-0">
              {rail}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

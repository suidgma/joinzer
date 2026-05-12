import { CheckCircle2, Circle } from 'lucide-react'

export type StepStatus = 'completed' | 'current' | 'upcoming'

export interface WizardStep {
  id: string
  label: string
  /** If provided, completed steps become anchor links. */
  href?: string
  status: StepStatus
}

interface WizardOutlineProps {
  steps: WizardStep[]
  title?: string
}

/**
 * Right-rail outline for multi-step wizard flows.
 * Desktop: sticky vertical step list. Completed steps are clickable if href provided.
 * Mobile: compact progress bar + "step N of M" label.
 */
export default function WizardOutline({ steps, title = 'Setup' }: WizardOutlineProps) {
  const completedCount = steps.filter((s) => s.status === 'completed').length
  const currentIndex = steps.findIndex((s) => s.status === 'current')
  const progressPct = Math.round((completedCount / steps.length) * 100)

  return (
    <>
      {/* Mobile: progress bar */}
      <div className="lg:hidden px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-600">{title}</span>
          <span className="text-xs text-gray-400">
            {Math.max(currentIndex, 0) + 1} of {steps.length}
          </span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-600 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Desktop: sticky vertical outline */}
      <div className="hidden lg:block sticky top-6">
        {title && (
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3 px-3">
            {title}
          </p>
        )}
        <nav className="space-y-0.5" aria-label="Setup steps">
          {steps.map((step) => {
            const isLink = step.status === 'completed' && step.href
            const Tag = isLink ? 'a' : 'div'
            const linkProps = isLink ? { href: step.href } : {}
            return (
              <Tag
                key={step.id}
                {...linkProps}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  step.status === 'current'
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : step.status === 'completed'
                    ? 'text-gray-700 hover:bg-gray-50 cursor-pointer'
                    : 'text-gray-400 cursor-default'
                }`}
              >
                {step.status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4 text-indigo-500 shrink-0" />
                ) : (
                  <Circle
                    className={`h-4 w-4 shrink-0 ${
                      step.status === 'current' ? 'text-indigo-500' : 'text-gray-300'
                    }`}
                  />
                )}
                {step.label}
              </Tag>
            )
          })}
        </nav>
      </div>
    </>
  )
}

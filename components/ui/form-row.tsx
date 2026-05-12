import { ReactNode } from 'react'

interface FormRowProps {
  label: string
  htmlFor?: string
  helpText?: string
  error?: string
  required?: boolean
  children: ReactNode
}

/**
 * Standard field layout for organizer setup forms.
 * Desktop: label left (fixed 48), input right.
 * Mobile: label stacks above input.
 * Error supersedes helpText — both occupy the same space below the input.
 */
export default function FormRow({
  label,
  htmlFor,
  helpText,
  error,
  required,
  children,
}: FormRowProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-start gap-1 lg:gap-8 py-4 border-b border-gray-100 last:border-0">
      <div className="lg:w-48 lg:shrink-0 lg:pt-2">
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-gray-700"
        >
          {label}
          {required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
        </label>
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {error ? (
          <p className="mt-1.5 text-sm text-red-600" role="alert">{error}</p>
        ) : helpText ? (
          <p className="mt-1.5 text-sm text-gray-500">{helpText}</p>
        ) : null}
      </div>
    </div>
  )
}

import { ReactNode } from 'react'

// Content-aware width for the input column. Keeps the actual pixel values in one
// place so forms can declare intent (a 2-digit number doesn't need 576px) rather
// than hardcoding widths per field.
//   xs → single small numbers (play days, points to win, max players)
//   sm → dates, money, short selects (skill, sub-credit cap)
//   md → datetime, medium selects
//   lg → text, textarea, multi-segment rows (time pickers, skill ranges) — default
type FieldWidth = 'xs' | 'sm' | 'md' | 'lg'

const FIELD_WIDTHS: Record<FieldWidth, string> = {
  xs: 'lg:max-w-[7rem]',
  sm: 'lg:max-w-[14rem]',
  md: 'lg:max-w-sm',
  lg: 'lg:max-w-xl',
}

interface FormRowProps {
  label: string
  htmlFor?: string
  helpText?: string
  error?: string
  required?: boolean
  /** Caps the input column on desktop so short fields aren't full-width. Default 'lg'. */
  width?: FieldWidth
  children: ReactNode
}

/**
 * Standard field layout for organizer setup forms.
 * Desktop: label left (fixed 48), input right (capped width — see `width`).
 * Mobile: label stacks above input.
 * Error supersedes helpText — both occupy the same space below the input.
 *
 * The input column is capped on desktop so fields don't stretch the full content
 * width (a date or number input doesn't need 900px). `width` picks the cap; the
 * default 'lg' (max-w-xl) suits text and multi-segment rows.
 */
export default function FormRow({
  label,
  htmlFor,
  helpText,
  error,
  required,
  width = 'lg',
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
      <div className={`flex-1 min-w-0 ${FIELD_WIDTHS[width]}`}>
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

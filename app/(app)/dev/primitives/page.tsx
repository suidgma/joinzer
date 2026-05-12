/**
 * Visual demo for the five layout primitives.
 * No real data — hardcoded content only.
 * Test at 375px, 768px, and 1280px to verify responsive behavior.
 */
import DesktopShell from '@/components/ui/desktop-shell'
import FormRow from '@/components/ui/form-row'
import FormSection from '@/components/ui/form-section'
import WizardOutline from '@/components/ui/wizard-outline'
import ManageNav from '@/components/ui/manage-nav'
import type { WizardStep } from '@/components/ui/wizard-outline'
import type { ManageNavItem } from '@/components/ui/manage-nav'

const WIZARD_STEPS: WizardStep[] = [
  { id: 'basics', label: 'Basics', href: '#', status: 'completed' },
  { id: 'format', label: 'Format & Divisions', href: '#', status: 'completed' },
  { id: 'schedule', label: 'Schedule', status: 'current' },
  { id: 'players', label: 'Players & Fees', status: 'upcoming' },
  { id: 'publish', label: 'Review & Publish', status: 'upcoming' },
]

const MANAGE_ITEMS: ManageNavItem[] = [
  { label: 'Overview', href: '/dev/primitives' },
  { label: 'Schedule', href: '/dev/primitives/schedule' },
  { label: 'Standings', href: '/dev/primitives/standings' },
  { label: 'Players', href: '/dev/primitives/players' },
  { label: 'Comms', href: '/dev/primitives/comms' },
  { label: 'Settings', href: '/dev/primitives/settings' },
]

// ── Shared input class to avoid repeating Tailwind strings ──────────────────
const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

export default function PrimitivesPage() {
  return (
    <div className="space-y-16 pb-24">

      {/* ── Section label ─────────────────────────────────────────────────── */}
      <div className="bg-indigo-700 text-white px-6 py-4">
        <h1 className="text-lg font-bold">Primitives Demo</h1>
        <p className="text-sm text-indigo-200">
          Resize to 375 / 768 / 1280px to verify responsive behavior.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          1. FormRow — three states
      ════════════════════════════════════════════════════════════════════ */}
      <section className="mx-auto max-w-3xl px-4 space-y-2">
        <SectionLabel index={1} name="FormRow" />
        <div className="bg-white rounded-lg border border-gray-200 px-4 lg:px-6">
          {/* State: with help text */}
          <FormRow
            label="Tournament name"
            htmlFor="demo-name"
            helpText="This is shown publicly on the listing page."
            required
          >
            <input id="demo-name" className={inputCls} defaultValue="Henderson Open 2026" />
          </FormRow>

          {/* State: with validation error */}
          <FormRow
            label="Start date"
            htmlFor="demo-date"
            error="Start date cannot be in the past."
            required
          >
            <input id="demo-date" type="date" className={`${inputCls} border-red-400`} defaultValue="2025-01-01" />
          </FormRow>

          {/* State: plain (no help, no error) */}
          <FormRow label="Location / venue" htmlFor="demo-venue">
            <input id="demo-venue" className={inputCls} placeholder="e.g. Cornerstone Park" />
          </FormRow>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          2. FormSection — open and closed states
      ════════════════════════════════════════════════════════════════════ */}
      <section className="mx-auto max-w-3xl px-4 space-y-3">
        <SectionLabel index={2} name="FormSection" />

        {/* Open by default */}
        <FormSection
          title="Format &amp; Divisions"
          description="Choose how the competition is structured."
          defaultOpen
        >
          <FormRow label="Format" htmlFor="demo-format">
            <select id="demo-format" className={inputCls}>
              <option>Round robin</option>
              <option>Single elimination</option>
              <option>Double elimination</option>
            </select>
          </FormRow>
          <FormRow label="Divisions" htmlFor="demo-divisions" helpText="Players self-select during registration.">
            <input id="demo-divisions" className={inputCls} defaultValue="Mens 3.5, Womens 3.5, Mixed 3.5" />
          </FormRow>
        </FormSection>

        {/* Closed by default — tests accordion closed state on mobile */}
        <FormSection
          title="Player Fees"
          description="Set per-team or per-player entry fees."
          defaultOpen={false}
        >
          <FormRow label="Entry fee" htmlFor="demo-fee" helpText="Leave blank for free entry.">
            <input id="demo-fee" type="number" className={inputCls} placeholder="0.00" />
          </FormRow>
        </FormSection>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          3. WizardOutline — standalone (mobile shows progress bar)
      ════════════════════════════════════════════════════════════════════ */}
      <section className="px-4 space-y-3">
        <div className="mx-auto max-w-3xl">
          <SectionLabel index={3} name="WizardOutline" />
          <p className="text-xs text-gray-400 mb-3">
            Mobile: progress bar above. Desktop: right-rail outline below (shown inline here for demo).
          </p>
        </div>
        {/* Progress bar is always rendered; outline shows at lg+ */}
        <div className="mx-auto max-w-xs">
          <WizardOutline steps={WIZARD_STEPS} title="Create Tournament" />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          4. ManageNav — standalone (mobile shows tab bar)
      ════════════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <div className="mx-auto max-w-3xl px-4">
          <SectionLabel index={4} name="ManageNav" />
          <p className="text-xs text-gray-400 mb-3">
            Mobile: horizontal tab bar. Desktop: vertical sidebar (shown inline here).
          </p>
        </div>
        <ManageNav items={MANAGE_ITEMS} />
        <div className="mx-auto max-w-xs px-4">
          {/* Desktop sidebar rendered in its own box for demo visibility */}
          <div className="hidden lg:block bg-white border border-gray-200 rounded-lg p-4">
            <ManageNav items={MANAGE_ITEMS} />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          5. DesktopShell — full composition
      ════════════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <div className="mx-auto max-w-3xl px-4">
          <SectionLabel index={5} name="DesktopShell (full composition)" />
          <p className="text-xs text-gray-400 mb-3">
            At lg+: sidebar left, rail right, content center. Below lg: sidebar/rail hidden,
            ManageNav and WizardOutline render in their own mobile positions.
          </p>
        </div>

        <DesktopShell
          header={
            <div className="flex items-center justify-between">
              <nav className="text-sm text-gray-500">
                <span>Tournaments</span>
                <span className="mx-2 text-gray-300">/</span>
                <span className="text-gray-900 font-medium">Henderson Open 2026</span>
              </nav>
              <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                Publish
              </button>
            </div>
          }
          sidebar={<ManageNav items={MANAGE_ITEMS} />}
          rail={<WizardOutline steps={WIZARD_STEPS} title="Create Tournament" />}
        >
          <FormSection title="Basics" description="Public-facing tournament details." defaultOpen>
            <FormRow label="Tournament name" htmlFor="shell-name" required>
              <input id="shell-name" className={inputCls} defaultValue="Henderson Open 2026" />
            </FormRow>
            <FormRow label="Venue" htmlFor="shell-venue" helpText="Will appear on the listing page.">
              <input id="shell-venue" className={inputCls} defaultValue="Cornerstone Park, Henderson NV" />
            </FormRow>
          </FormSection>

          <FormSection title="Format" defaultOpen={false}>
            <FormRow label="Format" htmlFor="shell-format">
              <select id="shell-format" className={inputCls}>
                <option>Round robin</option>
                <option>Single elimination</option>
              </select>
            </FormRow>
          </FormSection>
        </DesktopShell>
      </section>
    </div>
  )
}

// Small helper — not a primitive, demo-only
function SectionLabel({ index, name }: { index: number; name: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white shrink-0">
        {index}
      </span>
      <h2 className="text-base font-semibold text-gray-800">
        <code className="font-mono">&lt;{name}&gt;</code>
      </h2>
    </div>
  )
}

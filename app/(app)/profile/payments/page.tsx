export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  paid:    { label: 'Paid',    className: 'bg-green-100 text-green-700' },
  unpaid:  { label: 'Unpaid',  className: 'bg-yellow-100 text-yellow-700' },
  waived:  { label: 'Free',    className: 'bg-brand-soft text-brand-active' },
  pending: { label: 'Pending', className: 'bg-gray-100 text-gray-500' },
}

export default async function PaymentHistoryPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: registrations } = await db
    .from('tournament_registrations')
    .select(`
      id, status, payment_status, team_name, created_at,
      division:tournament_divisions!division_id (name),
      tournament:tournaments!tournament_id (id, name, start_date, cost_cents)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const regs = (registrations ?? []) as any[]

  const totalPaid = regs
    .filter((r) => r.payment_status === 'paid')
    .reduce((sum, r) => sum + ((r.tournament?.cost_cents ?? 0) as number), 0)

  return (
    <main className="max-w-lg mx-auto p-4 pb-24 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/profile" className="text-sm text-brand-muted hover:text-brand-dark">← Profile</Link>
      </div>

      <div className="flex items-start justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Payment History</h1>
        {totalPaid > 0 && (
          <p className="text-sm text-brand-muted">
            Total paid: <span className="font-semibold text-brand-dark">${(totalPaid / 100).toFixed(2)}</span>
          </p>
        )}
      </div>

      {regs.length === 0 && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-brand-dark">No tournament registrations yet.</p>
          <p className="text-xs text-brand-muted">When you register for a tournament, your payment history will appear here.</p>
          <Link href="/tournaments" className="inline-block mt-2 py-2 px-4 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors">
            Browse Tournaments
          </Link>
        </div>
      )}

      {regs.length > 0 && (
        <div className="space-y-3">
          {regs.map((reg) => {
            const tournament = reg.tournament
            const division = reg.division
            const costCents = tournament?.cost_cents ?? 0
            const payStatus = reg.payment_status ?? 'unpaid'
            const badge = STATUS_STYLES[payStatus] ?? STATUS_STYLES.pending

            return (
              <Link
                key={reg.id}
                href={tournament?.id ? `/tournaments/${tournament.id}` : '#'}
                className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold text-brand-dark truncate">
                      {tournament?.name ?? 'Tournament'}
                    </p>
                    {division?.name && (
                      <p className="text-xs text-brand-muted">{division.name}</p>
                    )}
                    {reg.team_name && (
                      <p className="text-xs text-brand-muted">Team: {reg.team_name}</p>
                    )}
                    <p className="text-xs text-brand-muted">
                      {tournament?.start_date ? formatSessionDate(tournament.start_date) : '—'}
                    </p>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                    {costCents > 0 && (
                      <p className={`text-sm font-semibold ${payStatus === 'paid' ? 'text-brand-dark' : 'text-brand-muted'}`}>
                        ${(costCents / 100).toFixed(2)}
                      </p>
                    )}
                    {costCents === 0 && (
                      <p className="text-xs text-brand-muted">Free</p>
                    )}
                  </div>
                </div>

                {payStatus === 'unpaid' && costCents > 0 && (
                  <p className="mt-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5">
                    Payment pending — visit the tournament page to complete checkout.
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}

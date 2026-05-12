'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Tag } from 'lucide-react'

type DiscountCode = {
  id: string
  code: string
  description: string | null
  discount_type: 'percent' | 'flat'
  discount_value: number
  max_uses: number | null
  uses_count: number
  expires_at: string | null
  is_active: boolean
}

type Props = {
  tournamentId: string
  initialCodes: DiscountCode[]
}

export default function DiscountCodesSection({ tournamentId, initialCodes }: Props) {
  const [codes, setCodes] = useState<DiscountCode[]>(initialCodes)
  const [showForm, setShowForm] = useState(false)
  const [fCode, setFCode] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fType, setFType] = useState<'percent' | 'flat'>('percent')
  const [fValue, setFValue] = useState('')
  const [fMaxUses, setFMaxUses] = useState('')
  const [fExpires, setFExpires] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!fCode.trim() || !fValue) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('tournament_discount_codes')
      .insert({
        tournament_id: tournamentId,
        code: fCode.trim().toUpperCase(),
        description: fDesc.trim() || null,
        discount_type: fType,
        discount_value: fType === 'percent'
          ? Math.min(100, Math.max(1, parseInt(fValue)))
          : Math.round(parseFloat(fValue) * 100),
        max_uses: fMaxUses ? parseInt(fMaxUses) : null,
        expires_at: fExpires || null,
        is_active: true,
      })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? 'Failed to create code'); setSaving(false); return }
    setCodes(prev => [...prev, data as DiscountCode])
    setShowForm(false)
    setFCode(''); setFDesc(''); setFType('percent'); setFValue(''); setFMaxUses(''); setFExpires('')
    setSaving(false)
  }

  async function toggleActive(code: DiscountCode) {
    const supabase = createClient()
    const { error: err } = await supabase
      .from('tournament_discount_codes')
      .update({ is_active: !code.is_active })
      .eq('id', code.id)
    if (!err) {
      setCodes(prev => prev.map(c => c.id === code.id ? { ...c, is_active: !c.is_active } : c))
    }
  }

  async function deleteCode(id: string) {
    if (!confirm('Delete this discount code?')) return
    const supabase = createClient()
    const { error: err } = await supabase
      .from('tournament_discount_codes')
      .delete()
      .eq('id', id)
    if (!err) setCodes(prev => prev.filter(c => c.id !== id))
  }

  function formatDiscount(code: DiscountCode) {
    if (code.discount_type === 'percent') return `${code.discount_value}% off`
    return `$${(code.discount_value / 100).toFixed(2)} off`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={14} className="text-brand-muted" />
          <h3 className="font-heading text-sm font-bold text-brand-dark">Discount Codes</h3>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm font-medium text-brand-active hover:underline flex items-center gap-1"
          >
            <Plus size={14} />
            Add Code
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-brand-surface border border-brand-border rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">Code</label>
              <input
                required
                type="text"
                value={fCode}
                onChange={e => setFCode(e.target.value.toUpperCase())}
                placeholder="EARLYBIRD"
                className="w-full input font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Type</label>
              <select value={fType} onChange={e => setFType(e.target.value as 'percent' | 'flat')} className="w-full input">
                <option value="percent">Percent off</option>
                <option value="flat">Fixed amount off</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">
                {fType === 'percent' ? 'Discount %' : 'Amount ($)'}
              </label>
              <input
                required
                type="number"
                min={fType === 'percent' ? 1 : 0.01}
                max={fType === 'percent' ? 100 : undefined}
                step={fType === 'percent' ? 1 : 0.01}
                value={fValue}
                onChange={e => setFValue(e.target.value)}
                placeholder={fType === 'percent' ? '20' : '10.00'}
                className="w-full input"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Description (optional)</label>
            <input
              type="text"
              value={fDesc}
              onChange={e => setFDesc(e.target.value)}
              placeholder="e.g. Early bird special"
              className="w-full input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Max Uses</label>
              <input
                type="number"
                min={1}
                value={fMaxUses}
                onChange={e => setFMaxUses(e.target.value)}
                placeholder="Unlimited"
                className="w-full input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Expires</label>
              <input
                type="date"
                value={fExpires}
                onChange={e => setFExpires(e.target.value)}
                className="w-full input"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating…' : 'Create Code'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {codes.length === 0 && !showForm && (
        <p className="text-xs text-brand-muted py-2">No discount codes yet.</p>
      )}

      {codes.length > 0 && (
        <div className="space-y-2">
          {codes.map(code => (
            <div
              key={code.id}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                code.is_active ? 'bg-white border-brand-border' : 'bg-brand-surface border-brand-border opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold text-brand-dark">{code.code}</span>
                  <span className="text-xs font-semibold text-brand-active bg-brand-soft px-2 py-0.5 rounded-full">
                    {formatDiscount(code)}
                  </span>
                  {!code.is_active && (
                    <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-brand-muted">
                  {code.description && <span>{code.description}</span>}
                  {code.max_uses != null && (
                    <span>{code.uses_count}/{code.max_uses} used</span>
                  )}
                  {code.max_uses == null && code.uses_count > 0 && (
                    <span>{code.uses_count} used</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleActive(code)}
                  className="text-xs font-medium text-brand-muted hover:text-brand-dark transition-colors"
                >
                  {code.is_active ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => deleteCode(code.id)}
                  className="p-1 text-brand-muted hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// App-wide styled replacement for window.confirm / window.alert. Mount <DialogProvider>
// once near the app root, then call useDialog() anywhere:
//   const { confirm, alert } = useDialog()
//   if (await confirm({ title: 'Delete block?', body: '…', danger: true })) { … }
//   await alert({ body: 'Something went wrong.' })
// Same bottom-sheet-on-mobile / centered-on-desktop look as the rest of the app.

type DialogOptions = {
  title?: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type DialogState = DialogOptions & { mode: 'confirm' | 'alert'; resolve: (v: boolean) => void }

type DialogApi = {
  confirm: (opts: DialogOptions) => Promise<boolean>
  alert: (opts: DialogOptions) => Promise<void>
}

const DialogContext = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within <DialogProvider>')
  return ctx
}

export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)
  const apiRef = useRef<DialogApi>(null as unknown as DialogApi)

  if (!apiRef.current) {
    apiRef.current = {
      confirm: (opts) => new Promise<boolean>(resolve => setState({ ...opts, mode: 'confirm', resolve })),
      alert: (opts) => new Promise<void>(resolve => setState({ ...opts, mode: 'alert', resolve: () => resolve() })),
    }
  }

  const close = useCallback((result: boolean) => {
    setState(prev => { prev?.resolve(result); return null })
  }, [])

  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, close])

  return (
    <DialogContext.Provider value={apiRef.current}>
      {children}
      {state && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={e => { if (e.target === e.currentTarget) close(false) }}
        >
          <div className="w-full sm:max-w-sm bg-white rounded-2xl p-6 space-y-4">
            {state.title && <h2 className="font-heading text-base font-bold text-brand-dark">{state.title}</h2>}
            {state.body && <p className="text-sm text-brand-muted whitespace-pre-line">{state.body}</p>}
            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
              {state.mode === 'confirm' && (
                <button
                  onClick={() => close(false)}
                  className="flex-1 py-2.5 rounded-xl border border-brand-border text-brand-dark text-sm font-semibold hover:border-brand-active transition-colors"
                >
                  {state.cancelLabel ?? 'Cancel'}
                </button>
              )}
              <button
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onClick={() => close(true)}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors ${
                  state.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-dark hover:bg-brand-dark/90'
                }`}
              >
                {state.confirmLabel ?? (state.mode === 'alert' ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

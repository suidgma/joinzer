'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export default function ContactPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [question, setQuestion] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, question }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.')
        setStatus('error')
        return
      }
      setStatus('success')
    } catch {
      setErrorMsg('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </Link>
      </header>

      <div className="max-w-lg mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-extrabold text-brand-dark mb-2">Contact</h1>
        <p className="text-brand-muted text-base mb-8">
          Have a question, feedback, or issue? Send us a message and we&apos;ll get back to you within 1–2 business days.
        </p>

        {status === 'success' ? (
          <div className="bg-brand-soft border border-brand-border rounded-2xl p-8 text-center">
            <p className="text-2xl mb-3">✓</p>
            <p className="font-heading font-bold text-brand-dark text-lg mb-2">Message sent</p>
            <p className="text-brand-muted text-sm mb-6">We&apos;ll reply to {email} within 1–2 business days.</p>
            <Link href="/" className="inline-block bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl text-sm hover:bg-brand-hover transition-colors">
              Back to home
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-brand-dark mb-1.5">
                Name <span className="text-brand-muted font-normal">(optional)</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full text-sm border border-brand-border rounded-xl px-4 py-3 text-brand-dark placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-active focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-brand-dark mb-1.5">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full text-sm border border-brand-border rounded-xl px-4 py-3 text-brand-dark placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-active focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="question" className="block text-sm font-medium text-brand-dark mb-1.5">
                Question or message <span className="text-red-500">*</span>
              </label>
              <textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What can we help you with?"
                required
                rows={5}
                className="w-full text-sm border border-brand-border rounded-xl px-4 py-3 text-brand-dark placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-active focus:border-transparent resize-none"
              />
            </div>

            {status === 'error' && (
              <p className="text-sm text-red-600">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full bg-brand text-brand-dark font-semibold px-6 py-3.5 rounded-xl text-sm hover:bg-brand-hover active:bg-brand-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

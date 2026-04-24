'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

interface Props {
  userId: string
  currentUrl: string | null
  onUpload: (url: string) => void
}

export default function PhotoUpload({ userId, currentUrl, onUpload }: Props) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      setError('Photo must be under 5 MB')
      return
    }

    setError(null)
    setUploading(true)

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)

    const supabase = createClient()
    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })

    if (uploadError) {
      setError('Upload failed. Please try again.')
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    onUpload(data.publicUrl)
    setUploading(false)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative w-24 h-24 rounded-full overflow-hidden bg-brand-soft border-2 border-brand-border hover:border-brand transition-colors group"
      >
        {preview ? (
          <Image src={preview} alt="Profile photo" fill className="object-cover" unoptimized />
        ) : (
          <span className="flex flex-col items-center justify-center w-full h-full text-brand-muted">
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </span>
        )}
        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-white text-xs font-medium">{preview ? 'Change' : 'Add photo'}</span>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />

      {uploading && <p className="text-xs text-brand-muted">Uploading…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!preview && !uploading && (
        <p className="text-xs text-brand-muted">JPG, PNG or WebP · max 5 MB</p>
      )}
    </div>
  )
}

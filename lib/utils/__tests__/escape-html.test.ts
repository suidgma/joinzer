import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../escape-html'

describe('escapeHtml', () => {
  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Saturday Morning Open Play')).toBe('Saturday Morning Open Play')
  })

  it('neutralizes a tag so it cannot open an element', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    )
  })

  it('neutralizes an injected anchor — the phishing shape this exists for', () => {
    const injected = '<a href="https://evil.example/reset">Reset your password</a>'
    const escaped = escapeHtml(injected)
    // The text "href=" survives — as inert text. What must not survive is a tag that can
    // open, or a quote that can close an attribute.
    expect(escaped).not.toContain('<a ')
    expect(escaped).not.toMatch(/href="/)
    expect(escaped).toContain('&lt;a href=&quot;https://evil.example/reset&quot;&gt;')
  })

  it('escapes both quote characters so a value cannot break out of an attribute', () => {
    expect(escapeHtml(`" onmouseover='x'`)).toBe('&quot; onmouseover=&#39;x&#39;')
  })

  it('escapes ampersands first so entities are not double-escaped', () => {
    // A naive implementation that runs `&` last turns `<` into `&lt;` and then into
    // `&amp;lt;`, which renders the literal text "&lt;" instead of a safe "<".
    expect(escapeHtml('Ampersand & <b>')).toBe('Ampersand &amp; &lt;b&gt;')
  })

  it('is idempotent in the sense that a second pass adds no new markup', () => {
    const once = escapeHtml('<b>"x"</b>')
    expect(escapeHtml(once)).not.toContain('<')
  })

  it('handles an empty string', () => {
    expect(escapeHtml('')).toBe('')
  })
})

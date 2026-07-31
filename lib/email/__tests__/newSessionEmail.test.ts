import { describe, it, expect } from 'vitest'
import { buildNewSessionEmailHtml, formatDuration } from '../newSessionEmail'

const BASE = {
  title: 'Saturday Morning Open Play',
  locationName: 'Sunset Park Courts',
  // 2026-08-01 09:30 Pacific.
  startsAt: '2026-08-01T16:30:00.000Z',
  durationMinutes: 90,
  maxPlayers: 12,
  eventUrl: 'https://www.joinzer.com/play/11111111-2222-3333-4444-555555555555',
  unsubscribeUrl: 'https://www.joinzer.com/api/unsubscribe?token=abc.123.sig',
}

describe('formatDuration', () => {
  it('drops the minutes when the duration is a whole number of hours', () => {
    expect(formatDuration(120)).toBe('2h')
  })

  it('keeps the minutes otherwise', () => {
    expect(formatDuration(90)).toBe('1h 30m')
  })

  it('renders a sub-hour duration as 0h Nm', () => {
    expect(formatDuration(45)).toBe('0h 45m')
  })
})

describe('buildNewSessionEmailHtml', () => {
  it('renders the session details in Pacific time', () => {
    const html = buildNewSessionEmailHtml(BASE)
    expect(html).toContain('Saturday Morning Open Play')
    expect(html).toContain('Sunset Park Courts')
    expect(html).toContain('Saturday, August 1, 2026')
    expect(html).toContain('9:30 AM')
    expect(html).toContain('1h 30m')
    expect(html).toContain('12 players')
    expect(html).toContain(`href="${BASE.eventUrl}"`)
    expect(html).toContain(`href="${BASE.unsubscribeUrl}"`)
  })

  it('escapes a title that carries markup', () => {
    const html = buildNewSessionEmailHtml({
      ...BASE,
      title: '<script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes an injected link in the location name — the phishing payload', () => {
    // The failure this route shipped with: body-supplied strings went into the template
    // raw, so any signed-in account could mail a working link to the whole opted-in list
    // from support@joinzer.com.
    const html = buildNewSessionEmailHtml({
      ...BASE,
      locationName: '<a href="https://evil.example/login">Verify your Joinzer account</a>',
    })
    // The hostname still appears — as inert text in the location cell. What must not exist
    // is a clickable anchor pointing at it.
    expect(html).not.toContain('href="https://evil.example')
    expect(html).toContain('&lt;a href=&quot;https://evil.example/login&quot;&gt;')
  })

  it('leaves exactly the two anchors the template owns', () => {
    // A count is the assertion that survives a template edit: any extra <a is injected.
    const html = buildNewSessionEmailHtml({
      ...BASE,
      title: '<a href="https://evil.example">one</a>',
      locationName: '<a href="https://evil.example">two</a>',
    })
    expect(html.match(/<a\s/g) ?? []).toHaveLength(2)
  })

  it('escapes a value trying to break out of the href attribute', () => {
    const html = buildNewSessionEmailHtml({
      ...BASE,
      eventUrl: 'https://www.joinzer.com/play/1" onclick="steal()',
    })
    // The closing quote must not survive as a real quote, or the rest becomes attributes.
    expect(html).not.toContain('onclick="')
    expect(html).toContain('&quot; onclick=&quot;steal()')
  })

  it('escapes markup that arrives through a non-string field coerced to text', () => {
    const html = buildNewSessionEmailHtml({
      ...BASE,
      maxPlayers: '<b>99</b>' as unknown as number,
    })
    expect(html).not.toContain('<b>99</b>')
    expect(html).toContain('&lt;b&gt;99&lt;/b&gt; players')
  })
})

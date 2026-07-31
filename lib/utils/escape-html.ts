// Escape a string for interpolation into HTML text content or a quoted attribute value.
//
// Transactional email is the reason this exists. An email template is a template literal,
// so `${title}` is raw HTML injection if `title` came from a user — and unlike a page, the
// output lands in someone else's inbox from a joinzer.com sender, which makes it a
// phishing and domain-deliverability problem rather than a self-XSS one.
//
// Escape, don't filter: values are stored as the user typed them and made inert at the
// point of rendering. `&` has to go first or it would double-escape the entities the later
// replacements introduce.
//
// NOT a URL sanitizer. Escaping makes a value safe to *place* inside `href="…"` — it cannot
// break out of the attribute — but it says nothing about where the link goes. `javascript:`
// and `data:` URLs contain no escapable character and survive this untouched. Any href built
// from a user-supplied URL needs a scheme allowlist (https/http/mailto) as well as this.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

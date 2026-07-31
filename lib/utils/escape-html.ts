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
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

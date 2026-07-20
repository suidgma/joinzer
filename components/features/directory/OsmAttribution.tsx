// ODbL requires attributing OpenStreetMap wherever its data is shown (brief §6). On every directory page.
export default function OsmAttribution() {
  return (
    <p className="text-xs text-brand-muted">
      Facility data ©{' '}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-brand-dark"
      >
        OpenStreetMap contributors
      </a>
      {' '}· enriched with AI. Details may be incomplete — please verify before visiting.
    </p>
  )
}

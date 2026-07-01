// Ask the service worker to fetch + cache these page URLs into the app-shell cache, so
// they load on an offline reload even when the organizer only reached them via client-side
// navigation (which never fetches the HTML document — see public/sw.js). No-op when there's
// no controlling service worker (first load, dev, unsupported browser).
export function precachePages(urls: string[]): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return
  navigator.serviceWorker.controller.postMessage({ type: 'precache', urls })
}

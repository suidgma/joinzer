import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Joinzer',
    short_name: 'Joinzer',
    description: 'Pickleball league & play session management',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9faf8',
    theme_color: '#a3c87a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}

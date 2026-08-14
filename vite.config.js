import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'offline.html', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'ToolTrack AutoLab',
        // Home-screen labels are truncated around 12 characters.
        short_name: 'ToolTrack',
        description:
          'ToolTrack AutoLab: QR-Based Automotive Laboratory Tool Monitoring System. ' +
          'Scan. Borrow. Track. Return.',
        // The launch screen is painted in `background_color` before a single
        // line of the app runs, so it is the same navy the shell's rail and the
        // sign-in panel use — and the same value `index.html` stamps on the root
        // element before the stylesheet loads. The hand-over from the system
        // splash to the first frame is therefore one continuous colour.
        theme_color: '#0B1220',
        background_color: '#0B1220',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        // The installed app belongs to laboratory staff and students who already
        // have accounts, so it opens the dashboard rather than the public
        // landing page. Signed out, the route guard sends them to /login.
        start_url: '/dashboard',
        categories: ['productivity', 'utilities', 'education'],
        // Android composes the launch screen from `background_color`, `name` and
        // the largest icon it can find, so the set has to cover both purposes at
        // both densities:
        //
        //   • `any` — the artwork edge to edge, used where nothing is cropped.
        //   • `maskable` — the same badge at 66% inside a `#0B1220` square, so
        //     the circle, squircle or rounded square a launcher crops to never
        //     cuts into the mark. Without a padded copy Android falls back to
        //     shrinking the `any` icon inside a white circle, which is what made
        //     the splash look unfinished.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Scan Tool', short_name: 'Scan', url: '/scan' },
          { name: 'Dashboard', short_name: 'Dashboard', url: '/dashboard' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'stms-images',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // Split the heavy, rarely-changing libraries so the service worker can cache
    // them independently of the application code.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          scanner: ['html5-qrcode'],
          qrcode: ['qrcode'],
        },
      },
    },
    // The vendor chunks are cached by the service worker after the first load,
    // so their size is not worth warning on.
    chunkSizeWarningLimit: 850,
  },
  server: { port: 5173, host: '0.0.0.0' },
  preview: { port: 4173, host: true },
})

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

// Served from https://<user>.github.io/<repo>/ — override with BASE_PATH if the
// host ever changes (e.g. Cloudflare Pages serves from the root).
const base = process.env.BASE_PATH ?? '/wh40k-helper/'

// Surfaced in Settings -> About so a bug report can name the exact build.
const commit = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7)

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_COMMIT__: JSON.stringify(commit),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'WH40k Play Helper',
        short_name: '40k Helper',
        description: 'List builder and play assistant for Warhammer 40,000 11th Edition.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0c0f0d',
        theme_color: '#0c0f0d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Game data lives in IndexedDB, fetched by the app itself — the service
        // worker must never cache or intercept those cross-origin requests.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
})

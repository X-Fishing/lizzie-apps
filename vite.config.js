import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Icones servidos de public/ (entram no precache do SW automaticamente).
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Lizzie Semijoias',
        short_name: 'Lizzie',
        description: 'App de gestao para revendedoras Lizzie Semijoias',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'pt-BR',
        background_color: '#1a0a2e',
        theme_color: '#1a0a2e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // HTML/JS/CSS sempre frescos quando online (igual ao comportamento anterior);
        // cai para o cache so offline. Assets do shell ficam em precache.
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}']
      }
    })
  ]
});

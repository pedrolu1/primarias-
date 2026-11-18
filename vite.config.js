import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Chaves do Firebase: aceita o bloco firebaseConfig inteiro, do jeito que o
// console mostra, numa variável só (FIREBASE_CONFIG, usada no GitHub Actions),
// ou as variáveis VITE_FIREBASE_* separadas (arquivo .env, no computador).
const CAMPOS = { apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID', storageBucket: 'STORAGE_BUCKET', messagingSenderId: 'MESSAGING_SENDER_ID', appId: 'APP_ID' };
for (const m of (process.env.FIREBASE_CONFIG || '').matchAll(/["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId)["']?\s*:\s*["']([^"']+)["']/g)) {
  const nome = `VITE_FIREBASE_${CAMPOS[m[1]]}`;
  if (!process.env[nome]) process.env[nome] = m[2];
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 800
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'REFRAMAX Primárias',
        short_name: 'Primárias',
        description: 'Lançamento e acompanhamento da substituição das válvulas primárias dos fornos da coqueria.',
        theme_color: '#0c111d',
        background_color: '#0c111d',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
      }
    })
  ]
});

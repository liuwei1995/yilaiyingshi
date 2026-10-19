import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Frame Player',
        short_name: 'Frame',
        description: '跨平台 HLS 视频播放器',
        theme_color: '#f8f8f2',
        background_color: '#f8f8f2',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/frame-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})

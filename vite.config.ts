import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const forwardedHost = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : undefined

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDesktopBuild = mode.startsWith('desktop-')

  return {
    base: isDesktopBuild ? './' : '/',
    server: {
      allowedHosts: forwardedHost ? [forwardedHost] : [],
      proxy: {
        '/api.php': {
          target: 'http://frp.xinaliu.com',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
      ...(!isDesktopBuild ? [VitePWA({
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
      })] : []),
    ],
  }
})

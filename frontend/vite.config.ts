import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path/win32'
import { loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET ||
    env.VITE_SERVER_URL ||
    'https://weather-tiles.zmbm.dev'
  const proxyUrl = new URL(proxyTarget)
  const proxyOrigin = proxyUrl.origin
  const proxyBasePath = proxyUrl.pathname.replace(/\/+$/, '')
  const withProxyBasePath = (requestPath: string) =>
    `${proxyBasePath}${requestPath}`.replace(/\/{2,}/g, '/')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // Sets "@" to point to the "src" directory
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/font': {
          target: proxyOrigin,
          changeOrigin: true,
          rewrite: withProxyBasePath,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
      css: true,
    },
  }
})

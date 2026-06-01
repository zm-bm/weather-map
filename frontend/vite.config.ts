import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import type { Plugin } from 'vite'

const DEV_ARTIFACT_ORIGIN = process.env.VITE_DEV_ARTIFACT_PROXY_TARGET ?? 'http://localhost:3000'
const DEV_API_ORIGIN = process.env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:8000'
const DEV_ARTIFACT_DELAY_MS = Math.max(
  0,
  Number.parseInt(
    process.env.VITE_DEV_ARTIFACT_DELAY_MS ?? process.env.DEV_ARTIFACT_DELAY_MS ?? '0',
    10
  ) || 0
)

function devArtifactDelay(): Plugin {
  return {
    name: 'weather-map-dev-artifact-delay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const artifactPath = req.url?.startsWith('/fields/') || req.url?.startsWith('/runs/')
        if (DEV_ARTIFACT_DELAY_MS <= 0 || !artifactPath) {
          next()
          return
        }

        setTimeout(next, DEV_ARTIFACT_DELAY_MS)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [devArtifactDelay(), react()],
  server: {
    fs: {
      allow: [
        path.resolve(__dirname, '..'),
      ],
    },
    proxy: {
      '/manifests': {
        target: DEV_ARTIFACT_ORIGIN,
        changeOrigin: true,
      },
      '/fields': {
        target: DEV_ARTIFACT_ORIGIN,
        changeOrigin: true,
      },
      '/runs': {
        target: DEV_ARTIFACT_ORIGIN,
        changeOrigin: true,
      },
      '/pmtiles': {
        target: DEV_ARTIFACT_ORIGIN,
        changeOrigin: true,
      },
      '/radio': {
        target: DEV_ARTIFACT_ORIGIN,
        changeOrigin: true,
      },
      '/glyphs': {
        target: DEV_ARTIFACT_ORIGIN,
        changeOrigin: true,
      },
      '/api': {
        target: DEV_API_ORIGIN,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      // Sets "@" to point to the "src" directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
  },
})

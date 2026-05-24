import { afterEach, describe, expect, it, vi } from 'vitest'

describe('config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    window.history.replaceState({}, '', '/')
  })

  it('derives artifact and basemap urls from the configured artifact base url', async () => {
    vi.stubEnv('VITE_ARTIFACT_BASE_URL', 'https://data.example.test')
    vi.stubEnv('VITE_BASEMAP_FILENAME', 'maps.world.pmtiles')

    const { default: config } = await import('./config')

    expect(config.frontendBaseUrl).toBe(window.location.origin)
    expect(config.artifactBaseUrl).toBe('https://data.example.test')
    expect(config.basemapUrl).toBe('pmtiles://https://data.example.test/pmtiles/maps.world.pmtiles')
  })

  it('defaults the artifact base url to the current frontend origin', async () => {
    window.history.replaceState({}, '', '/app')

    const { default: config } = await import('./config')

    expect(config.frontendBaseUrl).toBe(window.location.origin)
    expect(config.artifactBaseUrl).toBe(window.location.origin)
    expect(config.basemapUrl).toBeUndefined()
  })

  it('trims the basemap filename before building the pmtiles url', async () => {
    vi.stubEnv('VITE_BASEMAP_FILENAME', '  maps.world.pmtiles  ')

    const { default: config } = await import('./config')

    expect(config.basemapUrl).toBe(`pmtiles://${window.location.origin}/pmtiles/maps.world.pmtiles`)
  })
})

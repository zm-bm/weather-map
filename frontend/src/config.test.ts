import { afterEach, describe, expect, it, vi } from 'vitest'

describe('config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    window.history.replaceState({}, '', '/')
  })

  it('derives static asset urls from the static base url', async () => {
    vi.stubEnv('VITE_DATA_BASE_URL', 'https://data.example.test')

    const { default: config } = await import('./config')

    expect(config.mapGlyphsUrl).toBe(`${window.location.origin}/glyphs/{fontstack}/{range}.pbf`)
    expect(config.radioBaseUrl).toBe('https://data.example.test/radio')
    expect(config.manifestBaseUrl).toBe('https://data.example.test/manifests')
  })

  it('defaults the static base url to the current frontend origin', async () => {
    window.history.replaceState({}, '', '/app')

    const { default: config } = await import('./config')

    expect(config.mapGlyphsUrl).toBe(`${window.location.origin}/glyphs/{fontstack}/{range}.pbf`)
    expect(config.radioBaseUrl).toBe('http://localhost:3000/radio')
    expect(config.basemapUrl).toBeUndefined()
  })

  it('honors explicit static asset overrides', async () => {
    vi.stubEnv('VITE_MAP_GLYPHS_URL', 'https://cdn.example.test/fonts/{fontstack}/{range}.pbf')
    vi.stubEnv('VITE_BASEMAP_FILENAME', 'maps.world.pmtiles')
    vi.stubEnv('VITE_RADIO_BASE_URL', 'https://media.example.test/radio')

    const { default: config } = await import('./config')

    expect(config.mapGlyphsUrl).toBe('https://cdn.example.test/fonts/{fontstack}/{range}.pbf')
    expect(config.basemapUrl).toBe('pmtiles://http://localhost:3000/pmtiles/maps.world.pmtiles')
    expect(config.radioBaseUrl).toBe('https://media.example.test/radio')
  })
})

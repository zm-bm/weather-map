import type { WeatherMapConfig } from '../../config'

export function createConfigFixture(
  overrides: Partial<WeatherMapConfig> = {}
): WeatherMapConfig {
  return {
    dataBaseUrl: 'http://localhost:8081',
    manifestBaseUrl: 'http://localhost:8081/manifests',
    mapGlyphsUrl: 'http://localhost:5173/glyphs/{fontstack}/{range}.pbf',
    basemapUrl: 'pmtiles://http://localhost:3000/pmtiles/20260424.z6.pmtiles',
    radioBaseUrl: 'http://localhost:8081/radio',
    verifyPayloadSha256: false,
    ...overrides,
  }
}

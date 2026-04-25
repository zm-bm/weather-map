import type { WeatherMapConfig } from '../../config'

export function createConfigFixture(
  overrides: Partial<WeatherMapConfig> = {}
): WeatherMapConfig {
  return {
    frontendBaseUrl: 'http://localhost:5173',
    artifactBaseUrl: 'http://localhost:3000',
    basemapUrl: 'pmtiles://http://localhost:3000/pmtiles/20260424.z6.pmtiles',
    verifyPayloadSha256: false,
    ...overrides,
  }
}

import type { WeatherMapConfig } from '../../config'

export function createConfigFixture(
  overrides: Partial<WeatherMapConfig> = {}
): WeatherMapConfig {
  return {
    serverUrl: 'http://localhost:8081',
    manifestBaseUrl: 'http://localhost:8081/manifests',
    verifyScalarSha256: false,
    language: 'en',
    ...overrides,
  }
}

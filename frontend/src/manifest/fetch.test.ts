import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchCurrentManifest, fetchCycleManifest, fetchLatestManifest } from './fetch'
import {
  createCycleManifestPayloadFixture,
  createLatestManifestPayloadFixture,
  createSignalFixture,
} from '../test/fixtures'
import {
  createFetchErrorResponse,
  createFetchJsonResponse,
  stubFetchJsonOnce,
} from '../test/fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchLatestManifest', () => {
  it('fails on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchErrorResponse(503, 'Service Unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchLatestManifest({ signal: createSignalFixture() })
    ).rejects.toThrow('Failed to fetch latest manifest: 503 Service Unavailable')
  })
})

describe('fetchCycleManifest', () => {
  it('parses a valid v4 forecast manifest', async () => {
    stubFetchJsonOnce(createCycleManifestPayloadFixture())

    const manifest = await fetchCycleManifest('2026041312', { signal: createSignalFixture() })
    expect(manifest.version).toBe(4)
    expect(manifest.contract).toBe('forecast-binary-v2')
    expect(manifest.vectorVariables).toEqual(['wind10m_uv'])
  })

  it('rejects non-v4 contracts', async () => {
    stubFetchJsonOnce(
      createCycleManifestPayloadFixture({ version: 2, contract: 'weather-scalar-v1' })
    )

    await expect(
      fetchCycleManifest('2026041312', { signal: createSignalFixture() })
    ).rejects.toThrow('Unsupported cycle manifest version')
  })

  it('fails on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchCycleManifest('2026041312', { signal: createSignalFixture() })
    ).rejects.toThrow('Failed to fetch cycle manifest: 404 Not Found')
  })
})

describe('fetchCurrentManifest', () => {
  it('chains latest manifest lookup to cycle manifest fetch', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/latest.json')) {
        return createFetchJsonResponse(createLatestManifestPayloadFixture())
      }
      return createFetchJsonResponse(createCycleManifestPayloadFixture())
    })
    vi.stubGlobal('fetch', fetchMock)

    const manifest = await fetchCurrentManifest({ signal: createSignalFixture() })
    expect(manifest.cycle).toBe('2026041312')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

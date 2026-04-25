import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchCurrentManifest } from './fetch'
import {
  createCycleManifestPayloadFixture,
  createSignalFixture,
} from '../test/fixtures'
import {
  createFetchErrorResponse,
  stubFetchJsonOnce,
} from '../test/fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchCurrentManifest', () => {
  it('fails on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchErrorResponse(503, 'Service Unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchCurrentManifest({ signal: createSignalFixture() })
    ).rejects.toThrow('Failed to fetch current manifest: 503 Service Unavailable')
  })

  it('parses latest.json as the current cycle manifest', async () => {
    stubFetchJsonOnce(createCycleManifestPayloadFixture())

    const manifest = await fetchCurrentManifest({ signal: createSignalFixture() })
    expect(manifest.version).toBe(4)
    expect(manifest.contract).toBe('forecast-binary-v2')
    expect(manifest.vectorVariables).toEqual(['wind10m_uv'])
  })
})

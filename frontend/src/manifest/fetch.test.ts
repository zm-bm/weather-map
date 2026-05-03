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
    const fetchMock = stubFetchJsonOnce(createCycleManifestPayloadFixture())

    const manifest = await fetchCurrentManifest({ signal: createSignalFixture() })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/manifests/gfs/latest.json',
      expect.any(Object)
    )
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.payloadContract).toBe('forecast-binary-v2')
    expect(manifest.vectorProducts).toEqual(['wind10m_uv'])
  })

  it('fetches the selected model manifest', async () => {
    const fetchMock = stubFetchJsonOnce(createCycleManifestPayloadFixture())

    await fetchCurrentManifest({ modelId: 'icon', signal: createSignalFixture() })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/manifests/icon/latest.json',
      expect.any(Object)
    )
  })
})

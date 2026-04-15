import { describe, expect, it, vi } from 'vitest'

import { fetchCurrentManifest, fetchCycleManifest } from './client'
import {
  createCycleManifestPayloadFixture,
  createLatestManifestPayloadFixture,
  createSignalFixture,
} from '../../test/fixtures'

describe('fetchCycleManifest', () => {
  it('parses a valid v4 forecast manifest', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => createCycleManifestPayloadFixture(),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const manifest = await fetchCycleManifest('2026041312', { signal: createSignalFixture() })
    expect(manifest.version).toBe(4)
    expect(manifest.contract).toBe('forecast-binary-v2')
    expect(manifest.vectorVariables).toEqual(['wind10m_uv'])

    vi.unstubAllGlobals()
  })

  it('rejects non-v4 contracts', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () =>
        createCycleManifestPayloadFixture({ version: 2, contract: 'weather-scalar-v1' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchCycleManifest('2026041312', { signal: createSignalFixture() })
    ).rejects.toThrow('Unsupported cycle manifest version')

    vi.unstubAllGlobals()
  })
})

describe('fetchCurrentManifest', () => {
  it('chains latest manifest lookup to cycle manifest fetch', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/latest.json')) {
        return {
          ok: true,
          json: async () => createLatestManifestPayloadFixture(),
        }
      }
      return {
        ok: true,
        json: async () => createCycleManifestPayloadFixture(),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const manifest = await fetchCurrentManifest({ signal: createSignalFixture() })
    expect(manifest.cycle).toBe('2026041312')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })
})

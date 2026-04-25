import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchCurrentManifest } from './fetch'
import { loadScalarFrame } from '../forecast-layers/scalar'
import { loadVectorFrame } from '../forecast-layers/vector'
import {
  createConfigFixture,
  createCycleManifestPayloadFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '../test/fixtures'
import {
  createFetchArrayBufferResponse,
  createFetchErrorResponse,
  createFetchJsonResponse,
} from '../test/fetch'

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('manifest + frame loading end-to-end', () => {
  it('fetches current manifest and loads scalar/vector frames from it', async () => {
    const scalarPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const vectorPayload = createVectorPayloadFixture([5, 6, 7, 8], [-1, -2, -3, -4])

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.endsWith('/latest.json')) {
        return createFetchJsonResponse(createCycleManifestPayloadFixture())
      }

      if (url.endsWith('/tmp_surface.scalar.i16.bin')) {
        return createFetchArrayBufferResponse(scalarPayload)
      }

      if (url.endsWith('/wind10m_uv.vector.i8.bin')) {
        return createFetchArrayBufferResponse(vectorPayload)
      }

      return createFetchErrorResponse(404, 'Not Found')
    })

    vi.stubGlobal('fetch', fetchMock)

    const signal = createSignalFixture()
    const manifest = await fetchCurrentManifest({ signal })
    const config = createConfigFixture({
      artifactBaseUrl: 'http://localhost:3000',
    })

    const scalarFrame = await loadScalarFrame({
      config,
      manifest,
      variable: 'tmp_surface',
      hourToken: '000',
      signal,
    })

    const vectorFrame = await loadVectorFrame({
      config,
      manifest,
      variable: 'wind10m_uv',
      hourToken: '000',
      signal,
    })

    expect(manifest.cycle).toBe('2026041312')
    expect(Array.from(scalarFrame.values)).toEqual([1, 2, 3, 4])
    expect(Array.from(vectorFrame.u)).toEqual([5, 6, 7, 8])
    expect(Array.from(vectorFrame.v)).toEqual([-1, -2, -3, -4])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

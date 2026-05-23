import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchManifest, resolveActiveForecastRun } from '../forecast-manifest'
import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastProductRequest,
  createForecastProductTarget,
  loadForecastProducts,
} from '../forecast-products'
import {
  createMultiModelManifestFixture,
  createConfigFixture,
  createSingleTimeManifestFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from './fixtures'
import {
  createFetchArrayBufferResponse,
  createFetchErrorResponse,
  createFetchJsonResponse,
} from './fetch'

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('forecast manifest + data loading end-to-end', () => {
  it('fetches forecast manifest once and loads scalar/vector frames from it', async () => {
    const scalarPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const vectorPayload = createVectorPayloadFixture([5, 6, 7, 8], [-1, -2, -3, -4])
    const manifestPayload = createMultiModelManifestFixture({
      gfsManifest: createSingleTimeManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026041312',
      }),
      iconManifest: null,
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.endsWith('/manifests/forecast-manifest.json')) {
        return createFetchJsonResponse(manifestPayload)
      }

      if (url.endsWith('/fields/gfs/2026041312/000/tmp_surface.field.i16.bin')) {
        return createFetchArrayBufferResponse(scalarPayload)
      }

      if (url.endsWith('/fields/gfs/2026041312/000/wind10m_uv.field.i8.bin')) {
        return createFetchArrayBufferResponse(vectorPayload)
      }

      return createFetchErrorResponse(404, 'Not Found')
    })

    vi.stubGlobal('fetch', fetchMock)

    const signal = createSignalFixture()
    const manifest = await fetchManifest({ signal })
    const activeRun = resolveActiveForecastRun(manifest, 'gfs')
    if (!activeRun) throw new Error('Expected active run fixture')
    const particleLayers = getAvailableParticleLayers(activeRun)
    const config = createConfigFixture({
      artifactBaseUrl: 'http://localhost:3000',
    })

    const target = createForecastProductTarget({
      activeRun,
      selectedLayer: FORECAST_LAYERS_BY_ID.temperature!,
      windVectorSource: {
        id: String(particleLayers.wind!.id),
        artifactId: particleLayerSourceArtifactId(particleLayers.wind!),
      },
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
        lowerHourToken: '000',
        upperHourToken: '000',
        lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
        upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
        mix: 0,
      },
    })
    const loadedData = await loadForecastProducts({
      request: createForecastProductRequest({
        target,
        artifacts: createArtifactLoader({ config, activeRun, signal }),
        retryToken: 0,
      }),
    })

    expect(activeRun.latest.run.cycle).toBe('2026041312')
    expect(Array.from(loadedData.products.field?.lower.values ?? [], (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(Array.from(loadedData.products.windVectors?.lower.u ?? [])).toEqual([5, 6, 7, 8])
    expect(Array.from(loadedData.products.windVectors?.lower.v ?? [])).toEqual([-1, -2, -3, -4])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([input]) => toUrl(input)).some((url) => url.endsWith('/latest.json')))
      .toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchCurrentManifest } from './fetch'
import { FORECAST_LAYERS_BY_ID, getAvailableParticleLayers } from '../forecast-catalog'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastDataPlan,
  createForecastDataTarget,
  loadForecastData,
} from '../forecast-data'
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

describe('manifest + data loading end-to-end', () => {
  it('fetches current manifest and loads scalar/vector frames from it', async () => {
    const scalarPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const vectorPayload = createVectorPayloadFixture([5, 6, 7, 8], [-1, -2, -3, -4])

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.endsWith('/latest.json')) {
        return createFetchJsonResponse(createCycleManifestPayloadFixture())
      }

      if (url.endsWith('/tmp_surface.field.i16.bin')) {
        return createFetchArrayBufferResponse(scalarPayload)
      }

      if (url.endsWith('/wind10m_uv.field.i8.bin')) {
        return createFetchArrayBufferResponse(vectorPayload)
      }

      return createFetchErrorResponse(404, 'Not Found')
    })

    vi.stubGlobal('fetch', fetchMock)

    const signal = createSignalFixture()
    const manifest = await fetchCurrentManifest({ manifestPath: 'manifests/gfs/latest.json', signal })
    const particleLayers = getAvailableParticleLayers(manifest)
    const config = createConfigFixture({
      artifactBaseUrl: 'http://localhost:3000',
    })

    const target = createForecastDataTarget({
      manifest,
      selectedLayerId: FORECAST_LAYERS_BY_ID.temperature!.id,
      selectedLayer: FORECAST_LAYERS_BY_ID.temperature!,
      selectedParticleLayerId: particleLayers.wind!.id,
      selectedParticleLayer: particleLayers.wind!,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
        lowerHourToken: '000',
        upperHourToken: '000',
        lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
        upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
        mix: 0,
      },
      retryToken: 0,
    })
    const renderData = await loadForecastData({
      plan: createForecastDataPlan({
        target,
        artifacts: createArtifactLoader({ config, manifest, signal }),
      }),
    })

    expect(manifest.run.cycle).toBe('2026041312')
    expect(Array.from(renderData.field.lower.values, (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(Array.from(renderData.particles?.lower.u ?? [])).toEqual([5, 6, 7, 8])
    expect(Array.from(renderData.particles?.lower.v ?? [])).toEqual([-1, -2, -3, -4])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

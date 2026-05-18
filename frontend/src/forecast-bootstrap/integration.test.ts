import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchAvailabilityIndex } from '../forecast-availability'
import { FORECAST_LAYERS_BY_ID, getAvailableParticleLayers } from '../forecast-catalog'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastDataPlan,
  createForecastDataTarget,
  loadForecastData,
} from '../forecast-data'
import {
  createAvailabilityIndexFixture,
  createConfigFixture,
  createFrameManifestFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '../test/fixtures'
import {
  createFetchArrayBufferResponse,
  createFetchErrorResponse,
  createFetchJsonResponse,
} from '../test/fetch'
import { createCycleManifestFromAvailability } from './availabilityManifest'

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('availability bootstrap + data loading end-to-end', () => {
  it('fetches availability once, synthesizes a manifest, and loads scalar/vector frames from it', async () => {
    const scalarPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const vectorPayload = createVectorPayloadFixture([5, 6, 7, 8], [-1, -2, -3, -4])
    const availabilityPayload = createAvailabilityIndexFixture({
      gfsManifest: createFrameManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026041312',
      }),
      iconManifest: null,
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.endsWith('/manifests/availability-index.json')) {
        return createFetchJsonResponse(availabilityPayload)
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
    const availabilityIndex = await fetchAvailabilityIndex({ signal })
    const manifest = createCycleManifestFromAvailability({ availabilityIndex, modelId: 'gfs' })
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
    expect(fetchMock.mock.calls.map(([input]) => toUrl(input)).some((url) => url.endsWith('/latest.json')))
      .toBe(false)
  })
})

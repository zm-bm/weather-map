import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchManifest, resolveActiveForecastRun } from '@/forecast/manifest'
import {
  createForecastSyncSession,
} from '@/forecast/sync/load/session'
import {
  createRasterProbeSampler,
  sampleRasterFrameWithSampler,
} from '@/forecast/place-probes'
import {
  createMultiDatasetManifestFixture,
  createConfigFixture,
  createForecastSyncPlanFixture,
  createScalarArtifactFixture,
  createSingleTimeManifestFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorArtifactFixture,
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

describe('data manifest + forecast loading end-to-end', () => {
  it('fetches data manifest once and loads scalar/vector frames from it', async () => {
    const scalarPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const vectorPayload = createVectorPayloadFixture([5, 6, 7, 8], [-1, -2, -3, -4])
    const gfsManifest = createSingleTimeManifestFixture({
      dataset: { id: 'gfs', label: 'GFS' },
      cycle: '2026041312',
      run: {
        cycle: '2026041312',
        run_id: '20260413T120000Z-abcdef12',
        payload_root: 'runs/gfs/2026041312/20260413T120000Z-abcdef12/fields',
        generated_at: '2026-04-13T12:00:00Z',
        revision: 'rev',
      },
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          id: 'tmp_surface',
          payload_file: 'tmp_surface.field.i8.bin',
        }),
        wind10m_uv: createVectorArtifactFixture({
          id: 'wind10m_uv',
          payload_file: 'wind10m_uv.field.i8.bin',
        }),
      },
    })
    const manifestPayload = createMultiDatasetManifestFixture({
      gfsManifest,
      iconManifest: null,
      layers: gfsManifest.layers,
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.endsWith('/manifests/data-manifest.json')) {
        return createFetchJsonResponse(manifestPayload)
      }

      if (url.endsWith('/runs/gfs/2026041312/20260413T120000Z-abcdef12/fields/000/tmp_surface.field.i8.bin')) {
        return createFetchArrayBufferResponse(scalarPayload)
      }

      if (url.endsWith('/runs/gfs/2026041312/20260413T120000Z-abcdef12/fields/000/wind10m_uv.field.i8.bin')) {
        return createFetchArrayBufferResponse(vectorPayload)
      }

      return createFetchErrorResponse(404, `Not Found: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const signal = createSignalFixture()
    const manifest = await fetchManifest({ signal })
    const activeRun = resolveActiveForecastRun(manifest, 'gfs')
    if (!activeRun) throw new Error('Expected active run fixture')
    const config = createConfigFixture({
      artifactBaseUrl: 'http://localhost:3000',
    })

    const plan = createForecastSyncPlanFixture({
      activeRun,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
        lowerFrameId: '000',
        upperFrameId: '000',
        lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
        upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
        mix: 0,
      },
    })
    const windows = await createForecastSyncSession().createLoadJob({
      plan,
      config,
      signal,
      retryToken: 0,
    })
      .load()

    expect(activeRun.latest.run.cycle).toBe('2026041312')
    const rasterFrame = windows.raster?.lower
    expect(rasterFrame?.source.bands[0].id).toBe('value')
    const rasterSampler = rasterFrame
      ? createRasterProbeSampler(rasterFrame, { lon: rasterFrame.raster.grid.lon0, lat: rasterFrame.raster.grid.lat0 })
      : null
    expect(rasterSampler).not.toBeNull()
    expect(rasterFrame && rasterSampler
      ? Number(sampleRasterFrameWithSampler(rasterFrame, rasterSampler)?.toFixed(2))
      : null).toBe(1)
    expect(Array.from(windows.particles?.lower.raster.bands[0] ?? [])).toEqual([5, 6, 7, 8])
    expect(Array.from(windows.particles?.lower.raster.bands[1] ?? [])).toEqual([-1, -2, -3, -4])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([input]) => toUrl(input)).some((url) => url.endsWith('/latest.json')))
      .toBe(false)
  })
})

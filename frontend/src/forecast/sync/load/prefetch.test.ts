import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDeferred,
  createGridFixture,
  createScalarEncodingFixture,
  createSignalFixture,
} from '@/test/fixtures'
import type { ArtifactLoader, RawRasterBands } from '@/forecast/artifacts'
import { prefetchForecastFrames } from './prefetch'
import { normalizeForecastHourToken } from '@/forecast/manifest'
import { createForecastWindowPlanTestFixture } from './windowPlan.testHelpers'

type PrefetchArgsFixture = Parameters<typeof prefetchForecastFrames>[0]
type PrefetchWindowPlan = PrefetchArgsFixture['windowPlans'][number]

const loaders = {
  raster: vi.fn(),
  cloudLayers: vi.fn(),
  overlay: vi.fn(),
  contour: vi.fn(),
  particles: vi.fn(),
}

function plannedWindow(id: 'raster' | 'overlay' | 'contour' | 'particles') {
  const artifactId = `${id}_artifact`
  const frame = {
    source: { id },
    artifactId,
    bandIds: ['value'] as const,
    cacheKeyPrefix: `${id}:key`,
  }
  if (id === 'overlay') {
    return createForecastWindowPlanTestFixture({
      id,
      key: `${id}:key`,
      failurePolicy: 'optional',
      output: 'array',
      frames: [frame],
    })
  }
  return createForecastWindowPlanTestFixture({
    id,
    key: `${id}:key`,
    failurePolicy: id === 'contour' ? 'optional' : 'required',
    output: 'single',
    frame,
  })
}

function prefetchArgs(args: {
  forecastHours?: string[]
  windowPlans?: readonly PrefetchWindowPlan[]
  lowerHourToken?: string
  upperHourToken?: string
} = {}): Omit<PrefetchArgsFixture, 'aheadHourCount' | 'concurrency' | 'signal'> {
  const forecastHours = args.forecastHours ?? ['000', '003', '006', '009']
  return {
    lowerHourToken: normalizeForecastHourToken(args.lowerHourToken ?? '000'),
    upperHourToken: normalizeForecastHourToken(args.upperHourToken ?? '003'),
    forecastHourTokens: forecastHours.map(normalizeForecastHourToken),
    artifacts: artifacts(),
    windowPlans: args.windowPlans ?? [
      plannedWindow('raster'),
      plannedWindow('particles'),
    ],
  }
}

function artifacts(): ArtifactLoader {
  return {
    canLoadRasterBands: vi.fn(() => true),
    loadRawRasterBands: vi.fn(async (
      artifactId: string,
      hourToken: string,
      bandIds: readonly string[],
    ) => {
      const id = artifactId.replace(/_artifact$/, '') as keyof typeof loaders
      await loaders[id]?.(hourToken)
      const firstBandId = bandIds[0] ?? 'value'
      return {
        artifactId,
        hourToken,
        grid: createGridFixture({
          id: 'test_grid',
          nx: 1,
          ny: 1,
          lon0: 0,
          lat0: 0,
          dx: 1,
          dy: -1,
        }),
        encoding: createScalarEncodingFixture({
          id: 'test_encoding',
        }),
        bandIds: [firstBandId, ...bandIds.slice(1)],
        bands: bandIds.map(() => new Int8Array([1])),
      } satisfies RawRasterBands
    }),
  }
}

describe('prefetchForecastFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaders.raster.mockResolvedValue({ layerId: 'temperature' })
    loaders.cloudLayers.mockResolvedValue({ layerId: 'cloud_layers' })
    loaders.overlay.mockResolvedValue({ overlays: [{ artifactId: 'precip_type_surface' }] })
    loaders.contour.mockResolvedValue({ artifactId: 'prmsl_msl' })
    loaders.particles.mockResolvedValue({ artifactId: 'wind10m_uv' })
  })

  it('prefetches planned windows for the current window plus lookahead hours', async () => {
    await prefetchForecastFrames({
      ...prefetchArgs({ lowerHourToken: '0', upperHourToken: '3' }),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.raster.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
      '009',
    ])
    expect(loaders.particles.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
      '009',
    ])
    expect(loaders.overlay).not.toHaveBeenCalled()
    expect(loaders.contour).not.toHaveBeenCalled()
  })

  it('prefetches pressure payloads when the pressure data is planned', async () => {
    await prefetchForecastFrames({
      ...prefetchArgs({
        windowPlans: [
          plannedWindow('raster'),
          plannedWindow('contour'),
        ],
        lowerHourToken: '0',
        upperHourToken: '3',
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.raster.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
    expect(loaders.contour.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
    expect(loaders.particles).not.toHaveBeenCalled()
  })

  it('limits prefetch concurrency across planned windows', async () => {
    const requests: Array<ReturnType<typeof createDeferred<void>>> = []
    const deferredPrefetch = () => {
      const request = createDeferred<void>()
      requests.push(request)
      return request.promise
    }
    loaders.raster.mockImplementation(deferredPrefetch)
    loaders.particles.mockImplementation(deferredPrefetch)

    const prefetch = prefetchForecastFrames({
      ...prefetchArgs(),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.raster.mock.calls.length + loaders.particles.mock.calls.length)
      .toBe(2)

    requests[0]!.resolve()
    for (let tick = 0; tick < 10; tick += 1) {
      if (loaders.raster.mock.calls.length + loaders.particles.mock.calls.length >= 3) break
      await Promise.resolve()
    }

    expect(loaders.raster.mock.calls.length + loaders.particles.mock.calls.length)
      .toBe(3)

    let resolvedCount = 1
    while (resolvedCount < 8) {
      const request = requests[resolvedCount]
      if (request == null) {
        await Promise.resolve()
        continue
      }
      request.resolve()
      resolvedCount += 1
      await Promise.resolve()
    }
    await prefetch
  })

  it('suppresses individual prefetch failures', async () => {
    loaders.raster.mockRejectedValue(new Error('prefetch failed'))
    loaders.particles.mockRejectedValue(new Error('prefetch failed'))

    await expect(prefetchForecastFrames({
      ...prefetchArgs(),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })).resolves.toBeUndefined()

    expect(loaders.raster.mock.calls.length + loaders.particles.mock.calls.length)
      .toBe(8)
  })

  it('skips windows that are not planned', async () => {
    await prefetchForecastFrames({
      ...prefetchArgs({
        forecastHours: ['000', '003', '006'],
        windowPlans: [plannedWindow('raster')],
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.raster).toHaveBeenCalledTimes(3)
    expect(loaders.overlay).not.toHaveBeenCalled()
    expect(loaders.contour).not.toHaveBeenCalled()
    expect(loaders.particles).not.toHaveBeenCalled()
  })

  it('prefetches cloud layer raster payloads when planned', async () => {
    await prefetchForecastFrames({
      ...prefetchArgs({
        forecastHours: ['000', '003', '006'],
        windowPlans: [createForecastWindowPlanTestFixture({
          id: 'raster',
          key: 'cloudLayers:key',
          failurePolicy: 'required',
          output: 'single',
          frame: {
            source: { id: 'cloudLayers' },
            artifactId: 'cloudLayers_artifact',
            bandIds: ['value'],
            cacheKeyPrefix: 'cloudLayers:key',
          },
        })],
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.raster).not.toHaveBeenCalled()
    expect(loaders.cloudLayers.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
  })
})

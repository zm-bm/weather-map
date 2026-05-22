import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FORECAST_LAYERS_BY_ID, getAvailableParticleLayers } from '../forecast-catalog'
import {
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createSignalFixture,
} from '../test/fixtures'
import { createForecastDataTarget } from './target'
import type { ForecastDataPlan } from './plan'
import { prefetchForecastData } from './prefetch'

const loaders = {
  field: vi.fn(),
  cloudLayers: vi.fn(),
  precipTypeOverlay: vi.fn(),
  pressureContours: vi.fn(),
  particles: vi.fn(),
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createPlan(args: {
  forecastHours?: string[]
  includeOverlay?: boolean
  includeCloudLayers?: boolean
  includeContours?: boolean
  includeParticles?: boolean
  lowerHourToken?: string
  upperHourToken?: string
} = {}): ForecastDataPlan {
  const manifest = createSingleTimeManifestFixture({
    forecastHours: args.forecastHours ?? ['000', '003', '006', '009'],
    vectorArtifactIds: args.includeParticles === false ? [] : ['wind10m_uv'],
  })
  const activeRun = createActiveRunFixture(manifest)
  const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!
  const selectedParticleLayer = args.includeParticles === false
    ? null
    : getAvailableParticleLayers(activeRun).wind!
  const target = createForecastDataTarget({
    activeRun,
    selectedLayerId: selectedLayer.id,
    selectedLayer,
    selectedParticleLayerId: selectedParticleLayer?.id ?? null,
    selectedParticleLayer,
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 15),
      lowerHourToken: args.lowerHourToken ?? '000',
      upperHourToken: args.upperHourToken ?? '003',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 15),
      mix: 0.5,
    },
    retryToken: 0,
  })

  return {
    activeRun: target.activeRun,
    selectedValidTimeMs: target.selectedValidTimeMs,
    lowerHourToken: target.lowerHourToken,
    upperHourToken: target.upperHourToken,
    mix: target.mix,
    field: args.includeCloudLayers === true
      ? null
      : {
        key: 'field:key',
        load: loaders.field,
      },
    cloudLayers: args.includeCloudLayers === true
      ? {
        key: 'cloud-layers:key',
        load: loaders.cloudLayers,
      }
      : null,
    precipTypeOverlay: args.includeOverlay === true
      ? {
        key: 'precip-type-overlay:key',
        load: loaders.precipTypeOverlay,
      }
      : null,
    pressureContours: args.includeContours === true
      ? {
        key: 'pressure-contours:key',
        load: loaders.pressureContours,
      }
      : null,
    particles: args.includeParticles === false
      ? null
      : {
        key: 'particles:key',
        load: loaders.particles,
      },
  }
}

describe('prefetchForecastData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaders.field.mockResolvedValue({ layerId: 'temperature' })
    loaders.cloudLayers.mockResolvedValue({ layerId: 'cloud_layers' })
    loaders.precipTypeOverlay.mockResolvedValue({ artifactId: 'precip_type_surface' })
    loaders.pressureContours.mockResolvedValue({ artifactId: 'prmsl_msl' })
    loaders.particles.mockResolvedValue({ artifactId: 'wind10m_uv' })
  })

  it('prefetches planned channels for the current window plus lookahead hours', async () => {
    await prefetchForecastData({
      plan: createPlan({ lowerHourToken: '0', upperHourToken: '3' }),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field.mock.calls.map(([hourToken]) => hourToken)).toEqual([
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
    expect(loaders.precipTypeOverlay).not.toHaveBeenCalled()
    expect(loaders.pressureContours).not.toHaveBeenCalled()
  })

  it('prefetches pressure contour payloads when the contour channel is planned', async () => {
    await prefetchForecastData({
      plan: createPlan({
        includeContours: true,
        includeParticles: false,
        lowerHourToken: '0',
        upperHourToken: '3',
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
    expect(loaders.pressureContours.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
    expect(loaders.particles).not.toHaveBeenCalled()
  })

  it('limits prefetch concurrency across planned channels', async () => {
    const requests: Array<ReturnType<typeof deferred<void>>> = []
    const deferredPrefetch = () => {
      const request = deferred<void>()
      requests.push(request)
      return request.promise
    }
    loaders.field.mockImplementation(deferredPrefetch)
    loaders.particles.mockImplementation(deferredPrefetch)

    const prefetch = prefetchForecastData({
      plan: createPlan(),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field.mock.calls.length + loaders.particles.mock.calls.length)
      .toBe(2)

    requests[0]!.resolve()
    await Promise.resolve()

    expect(loaders.field.mock.calls.length + loaders.particles.mock.calls.length)
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
    loaders.field.mockRejectedValue(new Error('prefetch failed'))
    loaders.particles.mockRejectedValue(new Error('prefetch failed'))

    await expect(prefetchForecastData({
      plan: createPlan(),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })).resolves.toBeUndefined()

    expect(loaders.field.mock.calls.length + loaders.particles.mock.calls.length)
      .toBe(8)
  })

  it('skips particle payload prefetch when no particle channel is planned', async () => {
    await prefetchForecastData({
      plan: createPlan({
        forecastHours: ['000', '003', '006'],
        includeParticles: false,
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field).toHaveBeenCalledTimes(3)
    expect(loaders.precipTypeOverlay).not.toHaveBeenCalled()
    expect(loaders.pressureContours).not.toHaveBeenCalled()
    expect(loaders.particles).not.toHaveBeenCalled()
  })

  it('prefetches cloud layers payloads instead of scalar field payloads when planned', async () => {
    await prefetchForecastData({
      plan: createPlan({
        forecastHours: ['000', '003', '006'],
        includeCloudLayers: true,
        includeParticles: false,
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field).not.toHaveBeenCalled()
    expect(loaders.cloudLayers.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
  })
})

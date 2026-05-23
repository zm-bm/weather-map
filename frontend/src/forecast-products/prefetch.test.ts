import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createSignalFixture,
} from '../test/fixtures'
import type { ForecastProductRequest } from './request'
import type {
  ForecastProductId,
  ForecastProductLoad,
  ForecastProductTimeSlices,
} from './types'
import { prefetchForecastProducts } from './prefetch'

const loaders = {
  field: vi.fn(),
  cloudLayers: vi.fn(),
  precipType: vi.fn(),
  pressure: vi.fn(),
  windVectors: vi.fn(),
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

function product<K extends ForecastProductId>(
  id: K,
  load: (hourToken: string) => Promise<ForecastProductTimeSlices[K]>
): ForecastProductLoad<K> {
  return {
    id,
    key: `${id}:key`,
    failurePolicy: 'required',
    load,
  }
}

function createRequest(args: {
  forecastHours?: string[]
  products?: readonly ForecastProductLoad[]
  lowerHourToken?: string
  upperHourToken?: string
} = {}): ForecastProductRequest {
  return {
    activeRun: createActiveRunFixture(createSingleTimeManifestFixture({
      forecastHours: args.forecastHours ?? ['000', '003', '006', '009'],
    })),
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 15),
    lowerHourToken: args.lowerHourToken ?? '000',
    upperHourToken: args.upperHourToken ?? '003',
    mix: 0.5,
    requestKey: 'request:key',
    products: args.products ?? [
      product('field', loaders.field),
      product('windVectors', loaders.windVectors),
    ],
  }
}

describe('prefetchForecastProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaders.field.mockResolvedValue({ layerId: 'temperature' })
    loaders.cloudLayers.mockResolvedValue({ layerId: 'cloud_layers' })
    loaders.precipType.mockResolvedValue({ artifactId: 'precip_type_surface' })
    loaders.pressure.mockResolvedValue({ artifactId: 'prmsl_msl' })
    loaders.windVectors.mockResolvedValue({ artifactId: 'wind10m_uv' })
  })

  it('prefetches planned products for the current window plus lookahead hours', async () => {
    await prefetchForecastProducts({
      request: createRequest({ lowerHourToken: '0', upperHourToken: '3' }),
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
    expect(loaders.windVectors.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
      '009',
    ])
    expect(loaders.precipType).not.toHaveBeenCalled()
    expect(loaders.pressure).not.toHaveBeenCalled()
  })

  it('prefetches pressure payloads when the pressure product is planned', async () => {
    await prefetchForecastProducts({
      request: createRequest({
        products: [
          product('field', loaders.field),
          product('pressure', loaders.pressure),
        ],
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
    expect(loaders.pressure.mock.calls.map(([hourToken]) => hourToken)).toEqual([
      '000',
      '003',
      '006',
    ])
    expect(loaders.windVectors).not.toHaveBeenCalled()
  })

  it('limits prefetch concurrency across planned products', async () => {
    const requests: Array<ReturnType<typeof deferred<void>>> = []
    const deferredPrefetch = () => {
      const request = deferred<void>()
      requests.push(request)
      return request.promise
    }
    loaders.field.mockImplementation(deferredPrefetch)
    loaders.windVectors.mockImplementation(deferredPrefetch)

    const prefetch = prefetchForecastProducts({
      request: createRequest(),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field.mock.calls.length + loaders.windVectors.mock.calls.length)
      .toBe(2)

    requests[0]!.resolve()
    await Promise.resolve()

    expect(loaders.field.mock.calls.length + loaders.windVectors.mock.calls.length)
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
    loaders.windVectors.mockRejectedValue(new Error('prefetch failed'))

    await expect(prefetchForecastProducts({
      request: createRequest(),
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })).resolves.toBeUndefined()

    expect(loaders.field.mock.calls.length + loaders.windVectors.mock.calls.length)
      .toBe(8)
  })

  it('skips products that are not planned', async () => {
    await prefetchForecastProducts({
      request: createRequest({
        forecastHours: ['000', '003', '006'],
        products: [product('field', loaders.field)],
      }),
      aheadHourCount: 1,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(loaders.field).toHaveBeenCalledTimes(3)
    expect(loaders.precipType).not.toHaveBeenCalled()
    expect(loaders.pressure).not.toHaveBeenCalled()
    expect(loaders.windVectors).not.toHaveBeenCalled()
  })

  it('prefetches cloud layers payloads instead of scalar field payloads when planned', async () => {
    await prefetchForecastProducts({
      request: createRequest({
        forecastHours: ['000', '003', '006'],
        products: [product('cloudLayers', loaders.cloudLayers)],
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

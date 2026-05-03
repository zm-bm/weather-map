import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConfigFixture,
  createFrameManifestFixture,
  createManifestFixture,
  createSignalFixture,
} from '../test/fixtures'
import { loadForecastFrames, prefetchForecastFrames } from './frames'

const mocks = vi.hoisted(() => ({
  loadScalarFrameWindow: vi.fn(),
  loadVectorFrameWindow: vi.fn(),
  prefetchFramePayloads: vi.fn(),
  prefetchScalarFrames: vi.fn(),
}))

vi.mock('./scalar/frame', () => ({
  loadScalarFrameWindow: mocks.loadScalarFrameWindow,
  prefetchScalarFrames: mocks.prefetchScalarFrames,
}))

vi.mock('./vector/frame', () => ({
  loadVectorFrameWindow: mocks.loadVectorFrameWindow,
}))

vi.mock('./prefetch', () => ({
  prefetchFramePayloads: mocks.prefetchFramePayloads,
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('loadForecastFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadScalarFrameWindow.mockResolvedValue({ lower: { variableId: 'tmp_surface' } })
    mocks.loadVectorFrameWindow.mockResolvedValue({ lower: { metadata: { variableId: 'wind10m_uv' } } })
    mocks.prefetchFramePayloads.mockResolvedValue(undefined)
    mocks.prefetchScalarFrames.mockResolvedValue(undefined)
  })

  it('loads scalar and vector frame windows through their domain loaders', async () => {
    const config = createConfigFixture()
    const manifest = createManifestFixture({
      scalarProducts: ['rh_surface'],
      vectorProducts: ['gust10m_uv'],
    })
    const signal = createSignalFixture()
    const previousScalarWindow = { lower: { variableId: 'previous-scalar' } } as never
    const previousVectorWindow = { lower: { metadata: { variableId: 'previous-vector' } } } as never
    const previousWindows = {
      scalar: previousScalarWindow,
      vector: previousVectorWindow,
    }
    const scalar = { lower: { variableId: 'rh_surface' } }
    const vector = { lower: { metadata: { variableId: 'gust10m_uv' } } }

    mocks.loadScalarFrameWindow.mockResolvedValueOnce(scalar)
    mocks.loadVectorFrameWindow.mockResolvedValueOnce(vector)

    await expect(loadForecastFrames({
      config,
      manifest,
      activeScalar: manifest.scalarProducts[0]!,
      activeVector: manifest.vectorProducts[0]!,
      previousWindows,
      selectedValidTimeMs: 123,
      lowerHourToken: '000',
      upperHourToken: '003',
      mix: 0.5,
      signal,
    })).resolves.toEqual({ scalar, vector })

    expect(mocks.loadScalarFrameWindow).toHaveBeenCalledWith({
      config,
      manifest,
      previousWindow: previousScalarWindow,
      selectedValidTimeMs: 123,
      lowerHourToken: '000',
      upperHourToken: '003',
      mix: 0.5,
      variable: 'rh_surface',
      signal,
    })
    expect(mocks.loadVectorFrameWindow).toHaveBeenCalledWith({
      config,
      manifest,
      previousWindow: previousVectorWindow,
      selectedValidTimeMs: 123,
      lowerHourToken: '000',
      upperHourToken: '003',
      mix: 0.5,
      variable: 'gust10m_uv',
      signal,
    })
  })
})

describe('prefetchForecastFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetchFramePayloads.mockResolvedValue(undefined)
    mocks.prefetchScalarFrames.mockResolvedValue(undefined)
  })

  it('prefetches decoded scalar frames and vector payloads for the current window plus lookahead hours', async () => {
    const config = createConfigFixture()
    const manifest = createFrameManifestFixture({
      forecastHours: ['000', '003', '006', '009'],
    })
    const signal = createSignalFixture()

    await prefetchForecastFrames({
      config,
      manifest,
      activeScalar: manifest.scalarProducts[0]!,
      activeVector: manifest.vectorProducts[0]!,
      lowerHourToken: '0',
      upperHourToken: '3',
      aheadHourCount: 2,
      concurrency: 2,
      signal,
    })

    expect(mocks.prefetchScalarFrames.mock.calls.map(([args]) => ({
      variableId: args.variable,
      hourTokens: args.hourTokens,
    }))).toEqual([
      { variableId: 'tmp_surface', hourTokens: ['000'] },
      { variableId: 'tmp_surface', hourTokens: ['003'] },
      { variableId: 'tmp_surface', hourTokens: ['006'] },
      { variableId: 'tmp_surface', hourTokens: ['009'] },
    ])
    expect(mocks.prefetchFramePayloads.mock.calls.map(([args]) => ({
      frameKind: args.frameKind,
      variableId: args.variableId,
      hourTokens: args.hourTokens,
    }))).toEqual([
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['000'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['003'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['006'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['009'] },
    ])
  })

  it('limits prefetch concurrency', async () => {
    const requests: Array<ReturnType<typeof deferred<void>>> = []
    const deferredPrefetch = () => {
      const request = deferred<void>()
      requests.push(request)
      return request.promise
    }
    mocks.prefetchFramePayloads.mockImplementation(deferredPrefetch)
    mocks.prefetchScalarFrames.mockImplementation(deferredPrefetch)

    const manifest = createFrameManifestFixture({
      forecastHours: ['000', '003', '006', '009'],
    })
    const prefetch = prefetchForecastFrames({
      config: createConfigFixture(),
      manifest,
      activeScalar: manifest.scalarProducts[0]!,
      activeVector: manifest.vectorProducts[0]!,
      lowerHourToken: '000',
      upperHourToken: '003',
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })

    expect(mocks.prefetchScalarFrames.mock.calls.length + mocks.prefetchFramePayloads.mock.calls.length)
      .toBe(2)

    requests[0]!.resolve()
    await Promise.resolve()

    expect(mocks.prefetchScalarFrames.mock.calls.length + mocks.prefetchFramePayloads.mock.calls.length)
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
    const manifest = createFrameManifestFixture({
      forecastHours: ['000', '003', '006', '009'],
    })
    mocks.prefetchFramePayloads.mockRejectedValue(new Error('prefetch failed'))
    mocks.prefetchScalarFrames.mockRejectedValue(new Error('prefetch failed'))

    await expect(prefetchForecastFrames({
      config: createConfigFixture(),
      manifest,
      activeScalar: manifest.scalarProducts[0]!,
      activeVector: manifest.vectorProducts[0]!,
      lowerHourToken: '000',
      upperHourToken: '003',
      aheadHourCount: 2,
      concurrency: 2,
      signal: createSignalFixture(),
    })).resolves.toBeUndefined()

    expect(mocks.prefetchScalarFrames.mock.calls.length + mocks.prefetchFramePayloads.mock.calls.length)
      .toBe(8)
  })
})

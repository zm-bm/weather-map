import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActiveForecastRun } from '../forecast-manifest'
import {
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
  particleLayerSourceArtifactId,
  type LayerSpec,
} from '../forecast-catalog'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import { resolveForecastInterpolationWindow } from '../forecast-time'
import {
  createForecastProductTarget,
  type FieldInterpolationWindowData,
  type ForecastProductOptions,
  type ForecastProductTarget,
  type LoadedForecastProducts,
  type WindVectorSource,
} from '../forecast-products'
import type { ForecastRenderHost } from '../forecast-render'
import {
  createActiveRunFixture,
  createConfigFixture,
  createManifestFixture,
} from '../test/fixtures'
import { useRequestRunner } from './useRequestRunner'
import { useStartupController } from './useStartupController'

const DEFAULT_PRODUCT_OPTIONS: ForecastProductOptions = {
  pressure: true,
  windVectors: true,
}

const mocks = vi.hoisted(() => ({
  loadForecastProducts: vi.fn(),
  applyRenderData: vi.fn(),
  artifactLoaderSignals: [] as AbortSignal[],
  fieldWindow: {
    lower: { layerId: 'temperature' },
    upper: { layerId: 'temperature' },
    mix: 0,
  },
  particleWindow: {
    lower: { artifactId: 'wind10m_uv' },
    upper: { artifactId: 'wind10m_uv' },
    mix: 0,
  },
}))

vi.mock('../forecast-products', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-products')>()
  return {
    ...actual,
    loadForecastProducts: mocks.loadForecastProducts,
  }
})

vi.mock('../forecast-artifacts', () => ({
  createArtifactLoader: (args: { signal: AbortSignal }) => {
    mocks.artifactLoaderSignals.push(args.signal)
    return {
      canLoadScalar: vi.fn(() => true),
      canLoadVector: vi.fn(() => true),
      canLoadVectorComponents: vi.fn(() => true),
      loadScalar: vi.fn(),
      loadVector: vi.fn(),
      loadVectorComponents: vi.fn(),
      loadRawVectorComponents: vi.fn(),
    }
  },
}))

type TargetInput = {
  activeRun: ActiveForecastRun
  selectedLayer: LayerSpec
  windVectorSource: WindVectorSource | null
  targetTimeMs: number
}

type SyncHarnessArgs = {
  renderHost: ForecastRenderHost | null
  config: ReturnType<typeof createConfigFixture>
  targetInput: TargetInput | null
  syncCallbacks: ForecastTimeSyncCallbacks
  productOptions?: ForecastProductOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

function useSyncHarness(args: SyncHarnessArgs) {
  const startup = useStartupController()
  const target = useMemo(
    () => buildProductTarget(args.targetInput),
    [args.targetInput]
  )

  useRequestRunner({
    renderHost: args.renderHost,
    config: args.config,
    target,
    syncCallbacks: args.syncCallbacks,
    startup,
    productOptions: args.productOptions ?? DEFAULT_PRODUCT_OPTIONS,
    onProbeFrameChange: args.onProbeFrameChange,
  })

  return {
    ...startup.status,
  }
}

function createSyncCallbacks(): ForecastTimeSyncCallbacks {
  return {
    onRequestStart: vi.fn(),
    onRequestApplied: vi.fn(),
    onRequestError: vi.fn(),
  }
}

function validTimeFor(activeRun: ActiveForecastRun, hourId: string): number {
  const time = activeRun.latest.times.find((entry) => entry.id === hourId)
  if (!time) throw new Error(`Missing fixture time ${hourId}`)
  return Date.parse(time.validAt)
}

function createTargetInput(overrides: Partial<TargetInput> = {}): TargetInput {
  const activeRun = overrides.activeRun ?? createActiveRunFixture(createManifestFixture())
  const defaultLayerId = FORECAST_LAYER_GROUPS[0]?.defaultLayer
  const selectedLayer = defaultLayerId ? FORECAST_LAYERS_BY_ID[defaultLayerId] : undefined
  if (!selectedLayer) {
    throw new Error('Fixture manifest must include at least one catalog layer')
  }
  const particleLayers = getAvailableParticleLayers(activeRun)
  const defaultParticleLayerId = getDefaultParticleLayer(particleLayers)
  const windVectorSource = defaultParticleLayerId
    ? particleLayers[defaultParticleLayerId]
    : undefined
  return {
    activeRun,
    selectedLayer,
    windVectorSource: windVectorSource == null
      ? null
      : {
          id: String(windVectorSource.id),
          artifactId: particleLayerSourceArtifactId(windVectorSource),
        },
    targetTimeMs: validTimeFor(activeRun, activeRun.latest.times[0]?.id ?? '000'),
    ...overrides,
  }
}

function validTimeAt(input: TargetInput, index: number): number {
  const hourId = input.activeRun.latest.times[index]?.id ?? '000'
  return validTimeFor(input.activeRun, hourId)
}

function createBaseArgs(overrides: Partial<SyncHarnessArgs> = {}): SyncHarnessArgs {
  return {
    renderHost: { version: 1, apply: mocks.applyRenderData },
    config: createConfigFixture(),
    targetInput: createTargetInput(),
    syncCallbacks: createSyncCallbacks(),
    onProbeFrameChange: vi.fn(),
    ...overrides,
  }
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

function createLoadedProducts(overrides: {
  field?: unknown
  cloudLayers?: unknown | null
  probeField?: unknown | null
  precipType?: unknown | null
  pressure?: unknown | null
  windVectors?: unknown | null
} = {}): LoadedForecastProducts {
  return {
    products: {
      field: overrides.field ?? mocks.fieldWindow,
      cloudLayers: overrides.cloudLayers ?? null,
      precipType: overrides.precipType ?? null,
      pressure: overrides.pressure ?? null,
      windVectors: overrides.windVectors ?? mocks.particleWindow,
    },
    probeField: overrides.probeField === undefined
      ? mocks.fieldWindow
      : overrides.probeField,
  } as LoadedForecastProducts
}

function buildProductTarget(targetInput: TargetInput | null): ForecastProductTarget | null {
  if (!targetInput) return null
  const interpolationWindow = resolveForecastInterpolationWindow(
    targetInput.activeRun.latest.times,
    targetInput.targetTimeMs
  )

  return createForecastProductTarget({
    activeRun: targetInput.activeRun,
    selectedLayer: targetInput.selectedLayer,
    windVectorSource: targetInput.windVectorSource,
    interpolationWindow,
  })
}

describe('useRequestRunner + useStartupController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artifactLoaderSignals.length = 0
    mocks.loadForecastProducts.mockResolvedValue(createLoadedProducts())
    mocks.applyRenderData.mockReturnValue(undefined)
  })

  it('does not sync when data input is missing', async () => {
    const args = createBaseArgs({
      targetInput: null,
    })

    const { result } = renderHook(() => useSyncHarness(args))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastProducts).not.toHaveBeenCalled()
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
    expect(result.current.startupPhase).toBe('idle')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('waits for a render host before syncing', async () => {
    const args = createBaseArgs({
      renderHost: null,
    })
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastProducts).not.toHaveBeenCalled()
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      renderHost: { version: 1, apply: mocks.applyRenderData },
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('starts syncing when request becomes enabled', async () => {
    const targetInput = createTargetInput()
    const callbacks = createSyncCallbacks()
    const args = createBaseArgs({
      targetInput: null,
      syncCallbacks: callbacks,
    })
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    expect(mocks.loadForecastProducts).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({
      ...args,
      targetInput,
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(targetInput.targetTimeMs)
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('dedupes identical request keys for the same render host', async () => {
    const args = createBaseArgs()
    const callbacks = args.syncCallbacks

    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    })
    expect(result.current.startupErrorMessage).toBeNull()
    expect(result.current.startupPhase).toBe('ready')
    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
  })

  it('does not rerun requests when the probe frame callback changes', async () => {
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()
    const args = createBaseArgs({
      onProbeFrameChange: firstCallback,
    })
    const callbacks = args.syncCallbacks

    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
      expect(firstCallback).toHaveBeenCalledWith(mocks.fieldWindow)
    })
    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      onProbeFrameChange: secondCallback,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    expect(secondCallback).not.toHaveBeenCalled()

    const targetInput = args.targetInput as TargetInput
    rerender({
      ...args,
      onProbeFrameChange: secondCallback,
      targetInput: {
        ...targetInput,
        targetTimeMs: validTimeAt(targetInput, 1),
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(2)
      expect(secondCallback).toHaveBeenCalledWith(mocks.fieldWindow)
    })
  })

  it('does not rerun requests when sync callbacks change and uses the latest callbacks', async () => {
    const frames = createLoadedProducts()
    const request = deferred<typeof frames>()
    mocks.loadForecastProducts.mockImplementation(() => request.promise)

    const firstCallbacks = createSyncCallbacks()
    const secondCallbacks = createSyncCallbacks()
    const args = createBaseArgs({
      syncCallbacks: firstCallbacks,
    })

    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    expect(firstCallbacks.onRequestStart).toHaveBeenCalledWith(
      (args.targetInput as TargetInput).targetTimeMs
    )

    rerender({
      ...args,
      syncCallbacks: secondCallbacks,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    expect(secondCallbacks.onRequestStart).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(secondCallbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs
      )
    })
    expect(firstCallbacks.onRequestApplied).not.toHaveBeenCalled()
  })

  it('reapplies the current target when render host version changes', async () => {
    const args = createBaseArgs()
    const callbacks = args.syncCallbacks

    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    })

    rerender({
      ...args,
      renderHost: {
        ...(args.renderHost as ForecastRenderHost),
        version: 2,
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(2)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(2)
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(2)
    })
  })

  it('does not rerun requests while startup is blocked after an initial failure', async () => {
    const startupError = new Error('wind failed')
    mocks.loadForecastProducts.mockRejectedValueOnce(startupError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })

    rerender({
      ...args,
      targetInput: {
        ...(args.targetInput as TargetInput),
        targetTimeMs: validTimeAt(args.targetInput as TargetInput, 1),
      },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const frames = createLoadedProducts()
    const request = deferred<typeof frames>()
    mocks.loadForecastProducts.mockImplementation(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(
      (args.targetInput as TargetInput).targetTimeMs
    )
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('ignores abort errors (no onRequestError callback)', async () => {
    const abortError = new Error('Operation aborted')
    abortError.name = 'AbortError'

    mocks.loadForecastProducts.mockRejectedValue(abortError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).not.toHaveBeenCalled()
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestError).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('transitions to error, then retry reruns and reaches ready', async () => {
    const startupError = new Error('wind failed')
    mocks.loadForecastProducts
      .mockRejectedValueOnce(startupError)
      .mockResolvedValueOnce(createLoadedProducts())

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })
    expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(2)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('forwards later sync errors without re-entering startup error', async () => {
    const laterError = new Error('later timeline error')
    const probeFrame = {
      lower: { layerId: 'temperature', frame: 1 },
      upper: { layerId: 'temperature', frame: 1 },
      mix: 0,
    }
    mocks.loadForecastProducts
      .mockResolvedValueOnce(createLoadedProducts({ probeField: probeFrame }))
      .mockRejectedValueOnce(laterError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(probeFrame)
    })

    const nextValidTimeMs = validTimeAt(args.targetInput as TargetInput, 1)

    rerender({
      ...args,
      targetInput: {
        ...(args.targetInput as TargetInput),
        targetTimeMs: nextValidTimeMs,
      },
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(nextValidTimeMs, laterError)
    })
    expect(result.current.startupPhase).toBe('ready')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })

  it('forwards selected layer and wind-vector source to product loading', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface'],
      vectorArtifactIds: ['wind10m_uv'],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const windLayer = getAvailableParticleLayers(activeRun).wind!
    const windVectorSource = {
      id: String(windLayer.id),
      artifactId: particleLayerSourceArtifactId(windLayer),
    }
    const args = createBaseArgs({
      targetInput: createTargetInput({
        activeRun,
        selectedLayer,
        windVectorSource,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastProducts).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({ id: 'field', key: expect.any(String) }),
          expect.objectContaining({ id: 'windVectors', key: expect.any(String) }),
        ]),
      }),
    }))
  })

  it('forwards null wind-vector source to product loading when no wind-vector artifact is available', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const args = createBaseArgs({
      targetInput: createTargetInput({
        activeRun,
        selectedLayer,
        windVectorSource: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastProducts).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({ id: 'field', key: expect.any(String) }),
        ]),
      }),
    }))
    const requestArg = mocks.loadForecastProducts.mock.calls[0]?.[0]?.request
    expect(requestArg.products).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'windVectors' }),
    ]))
  })

  it('omits pressure contours from product loading when the map option is disabled', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['tmp_surface', 'prmsl_msl'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!
    const args = createBaseArgs({
      productOptions: { pressure: false, windVectors: true },
      targetInput: createTargetInput({
        activeRun,
        selectedLayer,
        windVectorSource: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    const requestArg = mocks.loadForecastProducts.mock.calls[0]?.[0]?.request
    expect(requestArg.products).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pressure' }),
    ]))
  })

  it('publishes the selected layer probe frame after render succeeds', async () => {
    const probeFrame = { lower: { layerId: 'relative_humidity' } }
    const frames = createLoadedProducts({
      field: probeFrame,
      probeField: probeFrame,
      windVectors: { lower: { artifactId: 'wind10m_uv' } },
    })
    mocks.loadForecastProducts.mockResolvedValueOnce(frames)
    const args = createBaseArgs()

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.applyRenderData).toHaveBeenCalledWith(frames)
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(frames.probeField)
    })
  })

  it('does not update the probe frame when render application fails', async () => {
    const renderError = new Error('render failed')
    mocks.applyRenderData.mockImplementationOnce(() => {
      throw renderError
    })
    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs,
        renderError
      )
      expect(result.current.startupPhase).toBe('error')
    })

    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('clears the applied probe field before loading a different probe channel', async () => {
    const probeFrame = { lower: { layerId: 'temperature', frame: 1 } }
    const firstFrames = createLoadedProducts({
      field: probeFrame,
      probeField: probeFrame,
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondRequest = deferred<typeof firstFrames>()
    mocks.loadForecastProducts
      .mockResolvedValueOnce(firstFrames)
      .mockImplementationOnce(() => secondRequest.promise)

    const args = createBaseArgs()
    const targetInput = args.targetInput as TargetInput
    const relativeHumidityLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(firstFrames.probeField)
    })

    rerender({
      ...args,
      targetInput: {
        ...targetInput,
        selectedLayer: relativeHumidityLayer,
        targetTimeMs: validTimeAt(targetInput, 1),
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(2)
      expect(args.onProbeFrameChange).toHaveBeenLastCalledWith(null)
    })

    secondRequest.resolve(firstFrames)
  })

  it('passes reusable previous layer and wind-vector interpolation windows to product loading', async () => {
    const firstFrames = createLoadedProducts({
      field: { lower: { layerId: 'temperature', frame: 1 } },
      probeField: { lower: { layerId: 'temperature', frame: 1 } },
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondFrames = createLoadedProducts({
      field: { lower: { layerId: 'temperature', frame: 2 } },
      probeField: { lower: { layerId: 'temperature', frame: 2 } },
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 2 } },
    })
    mocks.loadForecastProducts
      .mockResolvedValueOnce(firstFrames)
      .mockResolvedValueOnce(secondFrames)

    const args = createBaseArgs()
    const targetInput = args.targetInput as TargetInput
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
    })

    rerender({
      ...args,
      targetInput: {
        ...targetInput,
        targetTimeMs: validTimeAt(targetInput, 1),
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(2)
    })
    expect(mocks.loadForecastProducts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousWindows: expect.objectContaining({
          field: firstFrames.products.field,
          windVectors: firstFrames.products.windVectors,
        }),
      })
    )
  })

  it('resets startup state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    mocks.loadForecastProducts.mockImplementationOnce(() => {
      return request.promise
    })

    const args = createBaseArgs()
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).not.toHaveBeenCalled()
      expect(result.current.startupPhase).toBe('loading')
    })

    rerender({
      ...args,
      targetInput: null,
    })

    await waitFor(() => {
      expect(mocks.artifactLoaderSignals[0]?.aborted).toBe(true)
      expect(result.current.startupPhase).toBe('idle')
      expect(result.current.startupErrorMessage).toBeNull()
    })
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
  })

  it('aborts in-flight requests on unmount and ignores settled data', async () => {
    const frames = createLoadedProducts()
    const request = deferred<typeof frames>()
    mocks.loadForecastProducts.mockImplementationOnce(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { unmount } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(1)
      expect(mocks.artifactLoaderSignals[0]).toBeDefined()
    })

    unmount()
    expect(mocks.artifactLoaderSignals[0]?.aborted).toBe(true)

    await act(async () => {
      request.resolve(frames)
      await request.promise
      await Promise.resolve()
    })

    expect(mocks.applyRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()
    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when the target returns to an already applied frame', async () => {
    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.targetInput as TargetInput).targetTimeMs
      )
    })

    const request = deferred<void>()
    mocks.loadForecastProducts.mockImplementationOnce(() => {
      return request.promise
    })

    const nextValidTimeMs = validTimeAt(args.targetInput as TargetInput, 1)

    rerender({
      ...args,
      targetInput: {
        ...(args.targetInput as TargetInput),
        targetTimeMs: nextValidTimeMs,
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastProducts).toHaveBeenCalledTimes(2)
      expect(mocks.artifactLoaderSignals[1]).toBeDefined()
    })

    rerender(args)

    await waitFor(() => {
      expect(mocks.artifactLoaderSignals[1]?.aborted).toBe(true)
    })

    request.resolve()
    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastTimeSyncCallbacks } from '@/forecast/time'
import {
  type FieldInterpolationWindowData,
  type ForecastDataOptions,
  type ForecastDataSession,
  type ForecastDataTarget,
  type LoadedForecastData,
} from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import {
  createConfigFixture,
  createFieldLayerSourceFixture,
  createForecastDataTargetFixture,
} from '@/test/fixtures'
import { useRequestRunner } from './useRequestRunner'
import { useStartupController } from './useStartupController'

const DEFAULT_DATA_OPTIONS: ForecastDataOptions = {
  pressure: true,
  windVectors: true,
}

const mocks = vi.hoisted(() => ({
  createLoadJob: vi.fn(),
  loadJob: vi.fn(),
  commitJob: vi.fn(),
  resetSession: vi.fn(),
  applyRenderData: vi.fn(),
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

type SyncHarnessArgs = {
  renderHost: ForecastRenderHost | null
  config: ReturnType<typeof createConfigFixture>
  target: ForecastDataTarget | null
  syncCallbacks: ForecastTimeSyncCallbacks
  dataSession: ForecastDataSession
  dataOptions?: ForecastDataOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

function useSyncHarness(args: SyncHarnessArgs) {
  const startup = useStartupController()

  useRequestRunner({
    renderHost: args.renderHost,
    config: args.config,
    target: args.target,
    syncCallbacks: args.syncCallbacks,
    startup,
    dataSession: args.dataSession,
    dataOptions: args.dataOptions ?? DEFAULT_DATA_OPTIONS,
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

function targetAt(target: ForecastDataTarget, index: number, overrides: Partial<ForecastDataTarget> = {}): ForecastDataTarget {
  const validTime = target.activeRun.latest.times[index]
  if (!validTime) throw new Error(`Missing fixture time at index ${index}`)
  return createForecastDataTargetFixture({
    activeRun: target.activeRun,
    layerSource: target.layerSource,
    windVectorSource: target.windVectorSource,
    targetTimeMs: Date.parse(validTime.validAt),
    overrides,
  })
}

function createBaseArgs(overrides: Partial<SyncHarnessArgs> = {}): SyncHarnessArgs {
  return {
    renderHost: { version: 1, apply: mocks.applyRenderData },
    config: createConfigFixture(),
    target: createForecastDataTargetFixture(),
    syncCallbacks: createSyncCallbacks(),
    dataSession: createDataSessionFixture(),
    onProbeFrameChange: vi.fn(),
    ...overrides,
  }
}

function createDataSessionFixture(overrides: Partial<ForecastDataSession> = {}): ForecastDataSession {
  return {
    createLoadJob: mocks.createLoadJob,
    prefetch: vi.fn(),
    reset: mocks.resetSession,
    ...overrides,
  }
}

function createLoadJobFixture(overrides: {
  key?: string
  selectedValidTimeMs?: number
  shouldClearProbeFrame?: boolean
  load?: () => Promise<LoadedForecastData>
  commit?: (data: LoadedForecastData) => void
} = {}) {
  return {
    key: overrides.key ?? 'job:default',
    selectedValidTimeMs: overrides.selectedValidTimeMs ?? Date.UTC(2026, 3, 13, 12),
    shouldClearProbeFrame: overrides.shouldClearProbeFrame ?? false,
    load: overrides.load ?? mocks.loadJob,
    commit: overrides.commit ?? mocks.commitJob,
  }
}

function createDefaultLoadJob(args: {
  target: ForecastDataTarget
  retryToken: number
}) {
  return createLoadJobFixture({
    key: `job:${args.target.selectedValidTimeMs}:${args.retryToken}`,
    selectedValidTimeMs: args.target.selectedValidTimeMs,
  })
}

function createLoadJobSignal(index: number): AbortSignal {
  const signal = mocks.createLoadJob.mock.calls[index]?.[0]?.signal
  if (!(signal instanceof AbortSignal)) {
    throw new Error(`Missing createLoadJob signal ${index}`)
  }
  return signal
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

function createLoadedData(overrides: {
  field?: unknown
  cloudLayers?: unknown | null
  probeField?: unknown | null
  precipType?: unknown | null
  pressure?: unknown | null
  windVectors?: unknown | null
} = {}): LoadedForecastData {
  return {
    windows: {
      field: overrides.field ?? mocks.fieldWindow,
      cloudLayers: overrides.cloudLayers ?? null,
      precipType: overrides.precipType ?? null,
      pressure: overrides.pressure ?? null,
      windVectors: overrides.windVectors ?? mocks.particleWindow,
    },
    probeField: overrides.probeField === undefined
      ? mocks.fieldWindow
      : overrides.probeField,
  } as LoadedForecastData
}

describe('useRequestRunner + useStartupController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadJob.mockResolvedValue(createLoadedData())
    mocks.createLoadJob.mockImplementation(createDefaultLoadJob)
    mocks.applyRenderData.mockReturnValue(undefined)
  })

  it('does not sync when data input is missing', async () => {
    const args = createBaseArgs({
      target: null,
    })

    const { result } = renderHook(() => useSyncHarness(args))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadJob).not.toHaveBeenCalled()
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

    expect(mocks.loadJob).not.toHaveBeenCalled()
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      renderHost: { version: 1, apply: mocks.applyRenderData },
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('starts syncing when request becomes enabled', async () => {
    const target = createForecastDataTargetFixture()
    const callbacks = createSyncCallbacks()
    const args = createBaseArgs({
      target: null,
      syncCallbacks: callbacks,
    })
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    expect(mocks.loadJob).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({
      ...args,
      target,
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(target.selectedValidTimeMs)
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
    expect(mocks.loadJob).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadJob).toHaveBeenCalledTimes(1)
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
    expect(mocks.loadJob).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      onProbeFrameChange: secondCallback,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadJob).toHaveBeenCalledTimes(1)
    expect(secondCallback).not.toHaveBeenCalled()

    const target = args.target as ForecastDataTarget
    rerender({
      ...args,
      onProbeFrameChange: secondCallback,
      target: targetAt(target, 1),
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(2)
      expect(secondCallback).toHaveBeenCalledWith(mocks.fieldWindow)
    })
  })

  it('does not rerun requests when sync callbacks change and uses the latest callbacks', async () => {
    const frames = createLoadedData()
    const request = deferred<typeof frames>()
    mocks.loadJob.mockImplementation(() => request.promise)

    const firstCallbacks = createSyncCallbacks()
    const secondCallbacks = createSyncCallbacks()
    const args = createBaseArgs({
      syncCallbacks: firstCallbacks,
    })

    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    expect(firstCallbacks.onRequestStart).toHaveBeenCalledWith(
      (args.target as ForecastDataTarget).selectedValidTimeMs
    )

    rerender({
      ...args,
      syncCallbacks: secondCallbacks,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadJob).toHaveBeenCalledTimes(1)
    expect(secondCallbacks.onRequestStart).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(secondCallbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
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
      expect(mocks.loadJob).toHaveBeenCalledTimes(2)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(2)
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(2)
    })
  })

  it('does not rerun requests while startup is blocked after an initial failure', async () => {
    const startupError = new Error('wind failed')
    mocks.loadJob.mockRejectedValueOnce(startupError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })

    rerender({
      ...args,
      target: targetAt(args.target as ForecastDataTarget, 1),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadJob).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const frames = createLoadedData()
    const request = deferred<typeof frames>()
    mocks.loadJob.mockImplementation(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(
      (args.target as ForecastDataTarget).selectedValidTimeMs
    )
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('ignores abort errors (no onRequestError callback)', async () => {
    const abortError = new Error('Operation aborted')
    abortError.name = 'AbortError'

    mocks.loadJob.mockRejectedValue(abortError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
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
    mocks.loadJob
      .mockRejectedValueOnce(startupError)
      .mockResolvedValueOnce(createLoadedData())

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })
    expect(mocks.loadJob).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(2)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
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
    mocks.loadJob
      .mockResolvedValueOnce(createLoadedData({ probeField: probeFrame }))
      .mockRejectedValueOnce(laterError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(probeFrame)
    })

    const nextTarget = targetAt(args.target as ForecastDataTarget, 1)
    const nextValidTimeMs = nextTarget.selectedValidTimeMs

    rerender({
      ...args,
      target: nextTarget,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(nextValidTimeMs, laterError)
    })
    expect(result.current.startupPhase).toBe('ready')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })

  it('forwards selected layer and wind-vector source to data loading', async () => {
    const target = createForecastDataTargetFixture({
      layerSource: createFieldLayerSourceFixture({
        layerId: 'relative_humidity',
        paletteId: 'humidity.relative.percent.v1',
        displayRange: [0, 100],
        fieldSource: {
          kind: 'scalar',
          artifactId: 'rh_surface',
        },
      }),
    })
    const args = createBaseArgs({
      target,
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        windVectorSource: expect.objectContaining({
          artifactId: 'wind10m_uv',
        }),
      }),
    }))
  })

  it('forwards null wind-vector source to data loading when no wind-vector artifact is available', async () => {
    const args = createBaseArgs({
      target: createForecastDataTargetFixture({
        layerSource: createFieldLayerSourceFixture({
          layerId: 'relative_humidity',
          paletteId: 'humidity.relative.percent.v1',
          displayRange: [0, 100],
          fieldSource: {
            kind: 'scalar',
            artifactId: 'rh_surface',
          },
        }),
        windVectorSource: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        windVectorSource: null,
      }),
    }))
  })

  it('omits pressure contours from data loading when the map option is disabled', async () => {
    const args = createBaseArgs({
      dataOptions: { pressure: false, windVectors: true },
      target: createForecastDataTargetFixture({
        windVectorSource: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      options: { pressure: false, windVectors: true },
    }))
  })

  it('publishes the selected layer probe frame after render succeeds', async () => {
    const probeFrame = { lower: { layerId: 'relative_humidity' } }
    const frames = createLoadedData({
      field: probeFrame,
      probeField: probeFrame,
      windVectors: { lower: { artifactId: 'wind10m_uv' } },
    })
    mocks.loadJob.mockResolvedValueOnce(frames)
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
        (args.target as ForecastDataTarget).selectedValidTimeMs,
        renderError
      )
      expect(result.current.startupPhase).toBe('error')
    })

    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('clears the applied probe field before loading a different probe channel', async () => {
    const probeFrame = { lower: { layerId: 'temperature', frame: 1 } }
    const firstFrames = createLoadedData({
      field: probeFrame,
      probeField: probeFrame,
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondRequest = deferred<typeof firstFrames>()
    mocks.createLoadJob
      .mockImplementationOnce((args) => createDefaultLoadJob(args))
      .mockImplementationOnce((args) => createLoadJobFixture({
        key: `job:${args.target.selectedValidTimeMs}:${args.retryToken}`,
        selectedValidTimeMs: args.target.selectedValidTimeMs,
        shouldClearProbeFrame: true,
      }))
    mocks.loadJob
      .mockResolvedValueOnce(firstFrames)
      .mockImplementationOnce(() => secondRequest.promise)

    const args = createBaseArgs()
    const target = args.target as ForecastDataTarget
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(firstFrames.probeField)
    })

    rerender({
      ...args,
      target: targetAt(target, 1, {
        layerSource: createFieldLayerSourceFixture({
          layerId: 'relative_humidity',
          paletteId: 'humidity.relative.percent.v1',
          displayRange: [0, 100],
          fieldSource: {
            kind: 'scalar',
            artifactId: 'rh_surface',
          },
        }),
      }),
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(2)
      expect(args.onProbeFrameChange).toHaveBeenLastCalledWith(null)
    })

    secondRequest.resolve(firstFrames)
  })

  it('commits loaded data only after render application succeeds', async () => {
    const firstFrames = createLoadedData({
      field: { lower: { layerId: 'temperature', frame: 1 } },
      probeField: { lower: { layerId: 'temperature', frame: 1 } },
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondFrames = createLoadedData({
      field: { lower: { layerId: 'temperature', frame: 2 } },
      probeField: { lower: { layerId: 'temperature', frame: 2 } },
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 2 } },
    })
    mocks.loadJob
      .mockResolvedValueOnce(firstFrames)
      .mockResolvedValueOnce(secondFrames)

    const args = createBaseArgs()
    const target = args.target as ForecastDataTarget
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
    })
    expect(mocks.commitJob).toHaveBeenCalledWith(firstFrames)

    rerender({
      ...args,
      target: targetAt(target, 1),
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(2)
    })
    expect(mocks.commitJob).toHaveBeenCalledWith(secondFrames)
  })

  it('resets startup state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    mocks.loadJob.mockImplementationOnce(() => {
      return request.promise
    })

    const args = createBaseArgs()
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).not.toHaveBeenCalled()
      expect(result.current.startupPhase).toBe('loading')
    })

    rerender({
      ...args,
      target: null,
    })

    await waitFor(() => {
      expect(createLoadJobSignal(0).aborted).toBe(true)
      expect(result.current.startupPhase).toBe('idle')
      expect(result.current.startupErrorMessage).toBeNull()
    })
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
    expect(mocks.resetSession).toHaveBeenCalled()
  })

  it('aborts in-flight requests on unmount and ignores settled data', async () => {
    const frames = createLoadedData()
    const request = deferred<typeof frames>()
    mocks.loadJob.mockImplementationOnce(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { unmount } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(1)
      expect(createLoadJobSignal(0)).toBeDefined()
    })

    unmount()
    expect(createLoadJobSignal(0).aborted).toBe(true)
    expect(mocks.resetSession).toHaveBeenCalled()

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
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
    })

    const request = deferred<void>()
    mocks.loadJob.mockImplementationOnce(() => {
      return request.promise
    })

    const nextTarget = targetAt(args.target as ForecastDataTarget, 1)

    rerender({
      ...args,
      target: nextTarget,
    })

    await waitFor(() => {
      expect(mocks.loadJob).toHaveBeenCalledTimes(2)
      expect(createLoadJobSignal(1)).toBeDefined()
    })

    rerender(args)

    await waitFor(() => {
      expect(createLoadJobSignal(1).aborted).toBe(true)
    })

    request.resolve()
    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })
})

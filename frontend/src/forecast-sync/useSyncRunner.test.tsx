import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActiveForecastRun } from '../forecast-manifest'
import {
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
  type ParticleLayerId,
  type ParticleLayerSpec,
  type LayerId,
  type LayerSpec,
} from '../forecast-catalog'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import { resolveForecastInterpolationWindow } from '../forecast-time'
import { createForecastDataTarget, type ForecastDataTarget } from '../forecast-data'
import type { ForecastRenderHost } from '../forecast-render'
import {
  createActiveRunFixture,
  createConfigFixture,
  createManifestFixture,
} from '../test/fixtures'
import { useSyncRunner } from './useSyncRunner'
import { useStartupState } from './useStartupState'

const mocks = vi.hoisted(() => ({
  loadForecastData: vi.fn(),
  applyRenderData: vi.fn(),
  setForecastFieldData: vi.fn(),
  clearForecastFieldData: vi.fn(),
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

vi.mock('../forecast-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-data')>()
  return {
    ...actual,
    loadForecastData: mocks.loadForecastData,
  }
})

vi.mock('../forecast-artifacts', () => ({
  createArtifactLoader: (args: { signal: AbortSignal }) => {
    mocks.artifactLoaderSignals.push(args.signal)
    return {
      loadScalar: vi.fn(),
      loadVector: vi.fn(),
      loadVectorComponents: vi.fn(),
      loadRawVectorComponents: vi.fn(),
    }
  },
}))

vi.mock('../forecast-probe', () => ({
  forecastFieldDataStore: {
    publish: mocks.setForecastFieldData,
    clear: mocks.clearForecastFieldData,
  },
}))

type DataInput = {
  activeRun: ActiveForecastRun
  selectedLayerId: LayerId
  selectedLayer: LayerSpec
  selectedParticleLayerId: ParticleLayerId | null
  selectedParticleLayer: ParticleLayerSpec | null
  targetTimeMs: number
}

type SyncHarnessArgs = {
  renderHost: ForecastRenderHost | null
  config: ReturnType<typeof createConfigFixture>
  dataInput: DataInput | null
  syncCallbacks: ForecastTimeSyncCallbacks
  pressureContoursEnabled?: boolean
}

function useSyncHarness(args: SyncHarnessArgs) {
  const startup = useStartupState()
  const target = useMemo(
    () => buildDataTarget(args.dataInput, startup.retryToken),
    [args.dataInput, startup.retryToken]
  )

  useSyncRunner({
    renderHost: args.renderHost,
    config: args.config,
    target,
    syncCallbacks: args.syncCallbacks,
    startup,
    pressureContoursEnabled: args.pressureContoursEnabled,
  })

  return startup.status
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

function createDataInput(overrides: Partial<DataInput> = {}): DataInput {
  const activeRun = overrides.activeRun ?? createActiveRunFixture(createManifestFixture())
  const defaultLayerId = FORECAST_LAYER_GROUPS[0]?.defaultLayer
  const selectedLayer = defaultLayerId ? FORECAST_LAYERS_BY_ID[defaultLayerId] : undefined
  if (!selectedLayer) {
    throw new Error('Fixture manifest must include at least one catalog layer')
  }
  const particleLayers = getAvailableParticleLayers(activeRun)
  const defaultParticleLayerId = getDefaultParticleLayer(particleLayers)
  const selectedParticleLayer = defaultParticleLayerId
    ? particleLayers[defaultParticleLayerId]
    : undefined
  return {
    activeRun,
    selectedLayerId: selectedLayer.id,
    selectedLayer,
    selectedParticleLayerId: selectedParticleLayer?.id ?? null,
    selectedParticleLayer: selectedParticleLayer ?? null,
    targetTimeMs: validTimeFor(activeRun, activeRun.latest.times[0]?.id ?? '000'),
    ...overrides,
  }
}

function validTimeAt(input: DataInput, index: number): number {
  const hourId = input.activeRun.latest.times[index]?.id ?? '000'
  return validTimeFor(input.activeRun, hourId)
}

function createBaseArgs(overrides: Partial<SyncHarnessArgs> = {}): SyncHarnessArgs {
  return {
    renderHost: { version: 1, apply: mocks.applyRenderData },
    config: createConfigFixture(),
    dataInput: createDataInput(),
    syncCallbacks: createSyncCallbacks(),
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

function buildDataTarget(
  dataInput: DataInput | null,
  retryToken: number
): ForecastDataTarget | null {
  if (!dataInput) return null
  const interpolationWindow = resolveForecastInterpolationWindow(
    dataInput.activeRun.latest.times,
    dataInput.targetTimeMs
  )

  return createForecastDataTarget({
    activeRun: dataInput.activeRun,
    selectedLayerId: dataInput.selectedLayerId,
    selectedLayer: dataInput.selectedLayer,
    selectedParticleLayerId: dataInput.selectedParticleLayerId,
    selectedParticleLayer: dataInput.selectedParticleLayer,
    interpolationWindow,
    retryToken,
  })
}

describe('useSyncRunner + useStartupState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artifactLoaderSignals.length = 0
    mocks.loadForecastData.mockResolvedValue({
      field: mocks.fieldWindow,
      cloudLayers: null,
      probeField: mocks.fieldWindow,
      precipTypeOverlay: null,
      pressureContours: null,
      particles: mocks.particleWindow,
    })
    mocks.applyRenderData.mockReturnValue(undefined)
  })

  it('does not sync when data input is missing', async () => {
    const args = createBaseArgs({
      dataInput: null,
    })

    const { result } = renderHook(() => useSyncHarness(args))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
    expect(mocks.clearForecastFieldData).toHaveBeenCalledTimes(1)
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

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      renderHost: { version: 1, apply: mocks.applyRenderData },
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('starts syncing when request becomes enabled', async () => {
    const dataInput = createDataInput()
    const callbacks = createSyncCallbacks()
    const args = createBaseArgs({
      dataInput: null,
      syncCallbacks: callbacks,
    })
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({
      ...args,
      dataInput,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(dataInput.targetTimeMs)
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
    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
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
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(2)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(2)
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(2)
    })
  })

  it('does not rerun requests while startup is blocked after an initial failure', async () => {
    const startupError = new Error('wind failed')
    mocks.loadForecastData.mockRejectedValueOnce(startupError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })

    rerender({
      ...args,
      dataInput: {
        ...(args.dataInput as DataInput),
        targetTimeMs: validTimeAt(args.dataInput as DataInput, 1),
      },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const frames = {
      field: mocks.fieldWindow,
      cloudLayers: null,
      probeField: mocks.fieldWindow,
      precipTypeOverlay: null,
      pressureContours: null,
      particles: mocks.particleWindow,
    }
    const request = deferred<typeof frames>()
    mocks.loadForecastData.mockImplementation(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(
      (args.dataInput as DataInput).targetTimeMs
    )
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('ignores abort errors (no onRequestError callback)', async () => {
    const abortError = new Error('Operation aborted')
    abortError.name = 'AbortError'

    mocks.loadForecastData.mockRejectedValue(abortError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
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
    mocks.loadForecastData
      .mockRejectedValueOnce(startupError)
      .mockResolvedValueOnce({
        field: mocks.fieldWindow,
        cloudLayers: null,
        probeField: mocks.fieldWindow,
        pressureContours: null,
        particles: mocks.particleWindow,
      })

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })
    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyRenderData).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(2)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('forwards later sync errors without re-entering startup error', async () => {
    const laterError = new Error('later timeline error')
    mocks.loadForecastData
      .mockResolvedValueOnce({
        field: mocks.fieldWindow,
        cloudLayers: null,
        probeField: mocks.fieldWindow,
        pressureContours: null,
        particles: mocks.particleWindow,
      })
      .mockRejectedValueOnce(laterError)

    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })

    const nextValidTimeMs = validTimeAt(args.dataInput as DataInput, 1)

    rerender({
      ...args,
      dataInput: {
        ...(args.dataInput as DataInput),
        targetTimeMs: nextValidTimeMs,
      },
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(nextValidTimeMs, laterError)
    })
    expect(result.current.startupPhase).toBe('ready')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('forwards selected layer and selected particle layer to data loading', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface'],
      vectorArtifactIds: ['wind10m_uv'],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const selectedParticleLayer = getAvailableParticleLayers(activeRun).wind!
    const args = createBaseArgs({
      dataInput: createDataInput({
        activeRun,
        selectedLayerId: selectedLayer.id,
        selectedLayer,
        selectedParticleLayerId: selectedParticleLayer.id,
        selectedParticleLayer,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastData).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        field: expect.objectContaining({ key: expect.any(String) }),
        particles: expect.objectContaining({ key: expect.any(String) }),
      }),
    }))
  })

  it('forwards null particle selection to data loading when no particle artifact is available', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const args = createBaseArgs({
      dataInput: createDataInput({
        activeRun,
        selectedLayerId: selectedLayer.id,
        selectedLayer,
        selectedParticleLayerId: null,
        selectedParticleLayer: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastData).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        field: expect.objectContaining({ key: expect.any(String) }),
        particles: null,
      }),
    }))
  })

  it('omits pressure contours from data loading when the map option is disabled', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['tmp_surface', 'prmsl_msl'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!
    const args = createBaseArgs({
      pressureContoursEnabled: false,
      dataInput: createDataInput({
        activeRun,
        selectedLayerId: selectedLayer.id,
        selectedLayer,
        selectedParticleLayerId: null,
        selectedParticleLayer: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastData).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        pressureContours: null,
      }),
    }))
  })

  it('applies render data and publishes the selected layer probe frame after render succeeds', async () => {
    const frames = {
      field: { lower: { layerId: 'relative_humidity' } },
      cloudLayers: null,
      probeField: { lower: { layerId: 'relative_humidity' } },
      pressureContours: null,
      particles: { lower: { artifactId: 'wind10m_uv' } },
    }
    mocks.loadForecastData.mockResolvedValueOnce(frames)
    const args = createBaseArgs()

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.applyRenderData).toHaveBeenCalledWith(frames)
      expect(mocks.setForecastFieldData).toHaveBeenCalledWith(frames.probeField)
    })
    expect(mocks.applyRenderData.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setForecastFieldData.mock.invocationCallOrder[0])
  })

  it('does not publish a probe frame when render application fails', async () => {
    const renderError = new Error('render failed')
    mocks.applyRenderData.mockImplementationOnce(() => {
      throw renderError
    })
    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs,
        renderError
      )
      expect(result.current.startupPhase).toBe('error')
    })

    expect(mocks.setForecastFieldData).not.toHaveBeenCalled()
  })

  it('passes reusable previous layer and particle interpolation windows to data loading', async () => {
    const firstFrames = {
      field: { lower: { layerId: 'temperature', frame: 1 } },
      cloudLayers: null,
      probeField: { lower: { layerId: 'temperature', frame: 1 } },
      pressureContours: null,
      particles: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    }
    const secondFrames = {
      field: { lower: { layerId: 'temperature', frame: 2 } },
      cloudLayers: null,
      probeField: { lower: { layerId: 'temperature', frame: 2 } },
      pressureContours: null,
      particles: { lower: { artifactId: 'wind10m_uv', frame: 2 } },
    }
    mocks.loadForecastData
      .mockResolvedValueOnce(firstFrames)
      .mockResolvedValueOnce(secondFrames)

    const args = createBaseArgs()
    const dataInput = args.dataInput as DataInput
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    })

    rerender({
      ...args,
      dataInput: {
        ...dataInput,
        targetTimeMs: validTimeAt(dataInput, 1),
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(2)
    })
    expect(mocks.loadForecastData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousWindows: expect.objectContaining({
          field: firstFrames.field,
          particles: firstFrames.particles,
        }),
      })
    )
  })

  it('resets startup state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    mocks.loadForecastData.mockImplementationOnce(() => {
      return request.promise
    })

    const args = createBaseArgs()
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyRenderData).not.toHaveBeenCalled()
      expect(result.current.startupPhase).toBe('loading')
    })

    rerender({
      ...args,
      dataInput: null,
    })

    await waitFor(() => {
      expect(mocks.artifactLoaderSignals[0]?.aborted).toBe(true)
      expect(result.current.startupPhase).toBe('idle')
      expect(result.current.startupErrorMessage).toBeNull()
    })
    expect(mocks.clearForecastFieldData).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight request when the target returns to an already applied frame', async () => {
    const args = createBaseArgs()
    const callbacks = args.syncCallbacks
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.dataInput as DataInput).targetTimeMs
      )
    })

    const request = deferred<void>()
    mocks.loadForecastData.mockImplementationOnce(() => {
      return request.promise
    })

    const nextValidTimeMs = validTimeAt(args.dataInput as DataInput, 1)

    rerender({
      ...args,
      dataInput: {
        ...(args.dataInput as DataInput),
        targetTimeMs: nextValidTimeMs,
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(2)
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
  })
})

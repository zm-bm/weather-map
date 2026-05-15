import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CycleManifest } from '../manifest'
import {
  getAvailableGroups,
  getAvailableParticleLayers,
  getAvailableLayers,
  getDefaultParticleLayer,
  type ParticleLayerId,
  type ParticleLayerSpec,
  type LayerId,
  type LayerSpec,
} from '../forecast-catalog'
import type { ForecastTimeSyncBridge } from '../forecast-time'
import { resolveForecastInterpolationWindow } from '../forecast-time'
import { createForecastDataTarget } from '../forecast-data'
import { createConfigFixture, createManifestFixture, createMapFixture } from '../test/fixtures'
import type { ForecastSyncTarget } from './types'
import { useSyncRunner } from './useSyncRunner'
import { useStartupState } from './useStartupState'

const mocks = vi.hoisted(() => ({
  loadForecastData: vi.fn(),
  applyForecastRenderData: vi.fn(),
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
    }
  },
}))

vi.mock('../forecast-render', () => ({
  applyForecastRenderData: mocks.applyForecastRenderData,
}))

vi.mock('../forecast-probe', () => ({
  forecastFieldDataStore: {
    publish: mocks.setForecastFieldData,
    clear: mocks.clearForecastFieldData,
  },
}))

type SyncInput = {
  manifest: CycleManifest
  selectedLayerId: LayerId
  selectedLayer: LayerSpec
  selectedParticleLayerId: ParticleLayerId | null
  selectedParticleLayer: ParticleLayerSpec | null
  targetTimeMs: number
  sync: ForecastTimeSyncBridge
}

type SyncHarnessArgs = {
  getMap: () => ReturnType<typeof createMapFixture> | null
  mapReadyVersion: number
  config: ReturnType<typeof createConfigFixture>
  syncInput: SyncInput | null
}

function useSyncHarness(args: SyncHarnessArgs) {
  const startup = useStartupState()
  const target = useMemo(
    () => buildSyncTarget(args.syncInput, startup.retryToken),
    [args.syncInput, startup.retryToken]
  )

  useSyncRunner({
    getMap: args.getMap,
    mapReadyVersion: args.mapReadyVersion,
    config: args.config,
    target,
    startup,
  })

  return startup.status
}

function createSyncCallbacks(): ForecastTimeSyncBridge {
  return {
    onRequestStart: vi.fn(),
    onRequestApplied: vi.fn(),
    onRequestError: vi.fn(),
  }
}

function validTimeFor(manifest: CycleManifest, hourId: string): number {
  const time = manifest.times.find((entry) => entry.id === hourId)
  if (!time) throw new Error(`Missing fixture time ${hourId}`)
  return Date.parse(time.validAt)
}

function createSyncInput(overrides: Partial<SyncInput> = {}): SyncInput {
  const manifest = overrides.manifest ?? createManifestFixture()
  const layers = getAvailableLayers(manifest)
  const defaultLayerId = getAvailableGroups(layers)[0]?.defaultLayer
  const selectedLayer = defaultLayerId ? layers[defaultLayerId] : undefined
  if (!selectedLayer) {
    throw new Error('Fixture manifest must include at least one catalog layer')
  }
  const particleLayers = getAvailableParticleLayers(manifest)
  const defaultParticleLayerId = getDefaultParticleLayer(particleLayers)
  const selectedParticleLayer = defaultParticleLayerId
    ? particleLayers[defaultParticleLayerId]
    : undefined
  return {
    manifest,
    selectedLayerId: selectedLayer.id,
    selectedLayer,
    selectedParticleLayerId: selectedParticleLayer?.id ?? null,
    selectedParticleLayer: selectedParticleLayer ?? null,
    targetTimeMs: validTimeFor(manifest, manifest.times[0]?.id ?? '000'),
    sync: createSyncCallbacks(),
    ...overrides,
  }
}

function createBaseArgs(overrides: Partial<SyncHarnessArgs> = {}): SyncHarnessArgs {
  const map = createMapFixture()
  return {
    getMap: () => map,
    mapReadyVersion: 1,
    config: createConfigFixture(),
    syncInput: createSyncInput(),
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

function buildSyncTarget(
  syncInput: SyncInput | null,
  retryToken: number
): ForecastSyncTarget | null {
  if (!syncInput) return null
  const interpolationWindow = resolveForecastInterpolationWindow(
    syncInput.manifest.times,
    syncInput.targetTimeMs
  )

  return {
    ...createForecastDataTarget({
      manifest: syncInput.manifest,
      selectedLayerId: syncInput.selectedLayerId,
      selectedLayer: syncInput.selectedLayer,
      selectedParticleLayerId: syncInput.selectedParticleLayerId,
      selectedParticleLayer: syncInput.selectedParticleLayer,
      interpolationWindow,
      retryToken,
    }),
    sync: syncInput.sync,
  }
}

describe('useSyncRunner + useStartupState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artifactLoaderSignals.length = 0
    mocks.loadForecastData.mockResolvedValue({
      field: mocks.fieldWindow,
      particles: mocks.particleWindow,
    })
    mocks.applyForecastRenderData.mockReturnValue(undefined)
  })

  it('does not sync when sync input is missing', async () => {
    const args = createBaseArgs({
      syncInput: null,
    })

    const { result } = renderHook(() => useSyncHarness(args))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()
    expect(mocks.clearForecastFieldData).toHaveBeenCalledTimes(1)
    expect(result.current.startupPhase).toBe('idle')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('waits for map readiness before syncing', async () => {
    const args = createBaseArgs({
      mapReadyVersion: 0,
    })
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      mapReadyVersion: 1,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('waits for a map instance before syncing', async () => {
    const map = createMapFixture()
    const args = createBaseArgs({
      getMap: () => null,
    })
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      getMap: () => map,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('starts syncing when request becomes enabled', async () => {
    const syncInput = createSyncInput()
    const callbacks = syncInput.sync
    const args = createBaseArgs({
      syncInput: null,
    })
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    expect(mocks.loadForecastData).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({
      ...args,
      syncInput,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(syncInput.targetTimeMs)
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('dedupes identical request keys across rerenders', async () => {
    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge

    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    })
    expect(result.current.startupErrorMessage).toBeNull()
    expect(result.current.startupPhase).toBe('ready')
    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
  })

  it('does not rerun requests while startup is blocked after an initial failure', async () => {
    const startupError = new Error('wind failed')
    mocks.loadForecastData.mockRejectedValueOnce(startupError)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })

    rerender({
      ...args,
      syncInput: {
        ...(args.syncInput as SyncInput),
        targetTimeMs: validTimeFor(
          (args.syncInput as SyncInput).manifest,
          (args.syncInput as SyncInput).manifest.times[1]?.id ?? '000'
        ),
      },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const frames = {
      field: mocks.fieldWindow,
      particles: mocks.particleWindow,
    }
    const request = deferred<typeof frames>()
    mocks.loadForecastData.mockImplementation(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook(() => useSyncHarness(args))

    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(
      (args.syncInput as SyncInput).targetTimeMs
    )
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
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
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()
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
        particles: mocks.particleWindow,
      })

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })
    expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(2)
      expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
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
        particles: mocks.particleWindow,
      })
      .mockRejectedValueOnce(laterError)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })

    const nextValidTimeMs = validTimeFor(
      (args.syncInput as SyncInput).manifest,
      (args.syncInput as SyncInput).manifest.times[1]?.id ?? '000'
    )

    rerender({
      ...args,
      syncInput: {
        ...(args.syncInput as SyncInput),
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
    const selectedLayer = getAvailableLayers(manifest).relative_humidity!
    const selectedParticleLayer = getAvailableParticleLayers(manifest).wind!
    const args = createBaseArgs({
      syncInput: createSyncInput({
        manifest,
        selectedLayerId: selectedLayer.id,
        selectedLayer,
        selectedParticleLayerId: selectedParticleLayer.id,
        selectedParticleLayer,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
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
    const selectedLayer = getAvailableLayers(manifest).relative_humidity!
    const args = createBaseArgs({
      syncInput: createSyncInput({
        manifest,
        selectedLayerId: selectedLayer.id,
        selectedLayer,
        selectedParticleLayerId: null,
        selectedParticleLayer: null,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastRenderData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastData).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        field: expect.objectContaining({ key: expect.any(String) }),
        particles: null,
      }),
    }))
  })

  it('applies render data and publishes the selected layer probe frame after render succeeds', async () => {
    const map = createMapFixture()
    const frames = {
      field: { lower: { layerId: 'relative_humidity' } },
      particles: { lower: { artifactId: 'wind10m_uv' } },
    }
    mocks.loadForecastData.mockResolvedValueOnce(frames)
    const args = createBaseArgs({
      getMap: () => map,
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.applyForecastRenderData).toHaveBeenCalledWith(map, frames)
      expect(mocks.setForecastFieldData).toHaveBeenCalledWith(frames.field)
    })
    expect(mocks.applyForecastRenderData.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setForecastFieldData.mock.invocationCallOrder[0])
  })

  it('does not publish a probe frame when render application fails', async () => {
    const renderError = new Error('render failed')
    mocks.applyForecastRenderData.mockImplementationOnce(() => {
      throw renderError
    })
    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs,
        renderError
      )
      expect(result.current.startupPhase).toBe('error')
    })

    expect(mocks.setForecastFieldData).not.toHaveBeenCalled()
  })

  it('passes reusable previous layer and particle interpolation windows to data loading', async () => {
    const firstFrames = {
      field: { lower: { layerId: 'temperature', frame: 1 } },
      particles: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    }
    const secondFrames = {
      field: { lower: { layerId: 'temperature', frame: 2 } },
      particles: { lower: { artifactId: 'wind10m_uv', frame: 2 } },
    }
    mocks.loadForecastData
      .mockResolvedValueOnce(firstFrames)
      .mockResolvedValueOnce(secondFrames)

    const args = createBaseArgs()
    const syncInput = args.syncInput as SyncInput
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(1)
    })

    rerender({
      ...args,
      syncInput: {
        ...syncInput,
        targetTimeMs: validTimeFor(
          syncInput.manifest,
          syncInput.manifest.times[1]?.id ?? '000'
        ),
      },
    })

    await waitFor(() => {
      expect(mocks.loadForecastData).toHaveBeenCalledTimes(2)
    })
    expect(mocks.loadForecastData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousWindows: {
          field: firstFrames.field,
          particles: firstFrames.particles,
        },
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
      expect(mocks.applyForecastRenderData).not.toHaveBeenCalled()
      expect(result.current.startupPhase).toBe('loading')
    })

    rerender({
      ...args,
      syncInput: null,
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
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
      )
    })

    const request = deferred<void>()
    mocks.loadForecastData.mockImplementationOnce(() => {
      return request.promise
    })

    const nextValidTimeMs = validTimeFor(
      (args.syncInput as SyncInput).manifest,
      (args.syncInput as SyncInput).manifest.times[1]?.id ?? '000'
    )

    rerender({
      ...args,
      syncInput: {
        ...(args.syncInput as SyncInput),
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

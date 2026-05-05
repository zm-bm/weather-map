import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CycleManifest,
  ScalarProductId,
  VectorProductId,
} from '../manifest'
import type { ForecastTimeSyncBridge } from '../forecast-time'
import {
  frameWindowMinuteOffset,
  resolveForecastFrameWindow,
} from '../forecast-time'
import { createConfigFixture, createManifestFixture, createMapFixture } from '../test/fixtures'
import type { SyncRequest } from './types'
import { useSyncRunner } from './useSyncRunner'
import { useStartupState } from './useStartupState'

const mocks = vi.hoisted(() => ({
  loadForecastFrames: vi.fn(),
  applyForecastFrames: vi.fn(),
  setForecastProbeFrame: vi.fn(),
  clearForecastProbeFrame: vi.fn(),
  scalarFrame: {
    lower: { variableId: 'tmp_surface' },
    upper: { variableId: 'tmp_surface' },
    mix: 0,
  },
  vectorFrame: {
    lower: { metadata: { variableId: 'wind10m_uv' } },
    upper: { metadata: { variableId: 'wind10m_uv' } },
    mix: 0,
  },
}))

vi.mock('../forecast-frame', () => ({
  loadForecastFrames: mocks.loadForecastFrames,
}))

vi.mock('../forecast-layers', () => ({
  applyForecastFrames: mocks.applyForecastFrames,
}))

vi.mock('../forecast-probe', () => ({
  forecastProbeFrameStore: {
    publish: mocks.setForecastProbeFrame,
    clear: mocks.clearForecastProbeFrame,
  },
}))

type SyncInput = {
  manifest: CycleManifest
  activeScalar: ScalarProductId
  activeVector: VectorProductId
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
  const request = useMemo(
    () => buildSyncRequest(args.syncInput, startup.retryToken),
    [args.syncInput, startup.retryToken]
  )

  useSyncRunner({
    getMap: args.getMap,
    mapReadyVersion: args.mapReadyVersion,
    config: args.config,
    request,
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
  return {
    manifest,
    activeScalar: manifest.productsByLayerId.scalar[0]!,
    activeVector: manifest.productsByLayerId.vector[0]!,
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

function buildSyncRequest(
  syncInput: SyncInput | null,
  retryToken: number
): SyncRequest | null {
  if (!syncInput) return null
  const frameWindow = resolveForecastFrameWindow(
    syncInput.manifest.times,
    syncInput.targetTimeMs
  )
  const minuteOffset = frameWindowMinuteOffset(frameWindow)

  return {
    manifest: syncInput.manifest,
    activeScalar: syncInput.activeScalar,
    activeVector: syncInput.activeVector,
    selectedValidTimeMs: frameWindow.selectedValidTimeMs,
    lowerHourToken: frameWindow.lowerHourToken,
    upperHourToken: frameWindow.upperHourToken,
    mix: frameWindow.mix,
    requestKey: `${syncInput.manifest.run.cycle}:${syncInput.manifest.run.revision}:${syncInput.activeScalar}:${syncInput.activeVector}:${frameWindow.lowerHourToken}:${frameWindow.upperHourToken}:${minuteOffset}:${retryToken}`,
    sync: syncInput.sync,
  }
}

describe('useSyncRunner + useStartupState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadForecastFrames.mockResolvedValue({
      scalar: mocks.scalarFrame,
      vector: mocks.vectorFrame,
    })
    mocks.applyForecastFrames.mockReturnValue(undefined)
  })

  it('does not sync when sync input is missing', async () => {
    const args = createBaseArgs({
      syncInput: null,
    })

    const { result } = renderHook(() => useSyncHarness(args))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastFrames).not.toHaveBeenCalled()
    expect(mocks.applyForecastFrames).not.toHaveBeenCalled()
    expect(mocks.clearForecastProbeFrame).toHaveBeenCalledTimes(1)
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

    expect(mocks.loadForecastFrames).not.toHaveBeenCalled()
    expect(mocks.applyForecastFrames).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      mapReadyVersion: 1,
    })

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)
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

    expect(mocks.loadForecastFrames).not.toHaveBeenCalled()
    expect(mocks.applyForecastFrames).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      getMap: () => map,
    })

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)
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

    expect(mocks.loadForecastFrames).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({
      ...args,
      syncInput,
    })

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)
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
    expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)
  })

  it('does not rerun requests while startup is blocked after an initial failure', async () => {
    const startupError = new Error('wind failed')
    mocks.loadForecastFrames.mockRejectedValueOnce(startupError)

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

    expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastFrames).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const frames = {
      scalar: mocks.scalarFrame,
      vector: mocks.vectorFrame,
    }
    const request = deferred<typeof frames>()
    mocks.loadForecastFrames.mockImplementation(() => request.promise)

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

    mocks.loadForecastFrames.mockRejectedValue(abortError)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastFrames).not.toHaveBeenCalled()
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
    mocks.loadForecastFrames
      .mockRejectedValueOnce(startupError)
      .mockResolvedValueOnce({
        scalar: mocks.scalarFrame,
        vector: mocks.vectorFrame,
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
    expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
    expect(mocks.applyForecastFrames).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(2)
      expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.syncInput as SyncInput).targetTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('forwards later sync errors without re-entering startup error', async () => {
    const laterError = new Error('later timeline error')
    mocks.loadForecastFrames
      .mockResolvedValueOnce({
        scalar: mocks.scalarFrame,
        vector: mocks.vectorFrame,
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

  it('forwards active scalar and active vector to frame loading', async () => {
    const manifest = createManifestFixture({
      scalarProducts: ['rh_surface'],
      vectorProducts: ['gust10m_uv'],
    })
    const args = createBaseArgs({
      syncInput: createSyncInput({
        manifest,
        activeScalar: manifest.productsByLayerId.scalar[0]!,
        activeVector: manifest.productsByLayerId.vector[0]!,
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastFrames).toHaveBeenCalledTimes(1)
    })

    expect(mocks.loadForecastFrames).toHaveBeenCalledWith(expect.objectContaining({
      activeScalar: 'rh_surface',
      activeVector: 'gust10m_uv',
    }))
  })

  it('applies loaded frames and publishes the scalar probe frame after render succeeds', async () => {
    const map = createMapFixture()
    const frames = {
      scalar: { lower: { variableId: 'rh_surface' } },
      vector: { lower: { metadata: { variableId: 'wind10m_uv' } } },
    }
    mocks.loadForecastFrames.mockResolvedValueOnce(frames)
    const args = createBaseArgs({
      getMap: () => map,
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.applyForecastFrames).toHaveBeenCalledWith(map, frames)
      expect(mocks.setForecastProbeFrame).toHaveBeenCalledWith(frames.scalar)
    })
    expect(mocks.applyForecastFrames.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setForecastProbeFrame.mock.invocationCallOrder[0])
  })

  it('does not publish a probe frame when render application fails', async () => {
    const renderError = new Error('render failed')
    mocks.applyForecastFrames.mockImplementationOnce(() => {
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

    expect(mocks.setForecastProbeFrame).not.toHaveBeenCalled()
  })

  it('passes reusable previous scalar and vector frame windows to frame loading', async () => {
    const firstFrames = {
      scalar: { lower: { variableId: 'tmp_surface', frame: 1 } },
      vector: { lower: { metadata: { variableId: 'wind10m_uv', frame: 1 } } },
    }
    const secondFrames = {
      scalar: { lower: { variableId: 'tmp_surface', frame: 2 } },
      vector: { lower: { metadata: { variableId: 'wind10m_uv', frame: 2 } } },
    }
    mocks.loadForecastFrames
      .mockResolvedValueOnce(firstFrames)
      .mockResolvedValueOnce(secondFrames)

    const args = createBaseArgs()
    const syncInput = args.syncInput as SyncInput
    const { rerender } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
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
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(2)
    })
    expect(mocks.loadForecastFrames).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousWindows: {
          scalar: firstFrames.scalar,
          vector: firstFrames.vector,
        },
      })
    )
  })

  it('resets startup state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    const observedSignals: AbortSignal[] = []
    mocks.loadForecastFrames.mockImplementationOnce((args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return request.promise
    })

    const args = createBaseArgs()
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(1)
      expect(mocks.applyForecastFrames).not.toHaveBeenCalled()
      expect(result.current.startupPhase).toBe('loading')
    })

    rerender({
      ...args,
      syncInput: null,
    })

    await waitFor(() => {
      expect(observedSignals[0]?.aborted).toBe(true)
      expect(result.current.startupPhase).toBe('idle')
      expect(result.current.startupErrorMessage).toBeNull()
    })
    expect(mocks.clearForecastProbeFrame).toHaveBeenCalledTimes(1)
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
    const observedSignals: AbortSignal[] = []
    mocks.loadForecastFrames.mockImplementationOnce((syncArgs: { signal: AbortSignal }) => {
      observedSignals.push(syncArgs.signal)
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
      expect(mocks.loadForecastFrames).toHaveBeenCalledTimes(2)
      expect(observedSignals[0]).toBeDefined()
    })

    rerender(args)

    await waitFor(() => {
      expect(observedSignals[0]?.aborted).toBe(true)
    })

    request.resolve()
    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
  })
})

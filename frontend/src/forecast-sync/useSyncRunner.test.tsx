import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../manifest'
import type { ForecastTimeSyncBridge } from '../forecast-time/types'
import { hourTokenAt, normalizeHourIndex } from '../forecast-time/time'
import { createConfigFixture, createManifestFixture, createMapFixture } from '../test/fixtures'
import type { SyncRequest } from './types'
import { useSyncRunner } from './useSyncRunner'
import { useStartupState } from './useStartupState'

const mocks = vi.hoisted(() => ({
  scalarApplySync: vi.fn(),
  vectorApplySync: vi.fn(),
}))

vi.mock('../forecast-layers', () => ({
  syncableForecastLayers: [
    {
      layerId: 'scalar-layer-id',
      install: vi.fn(),
      applySync: mocks.scalarApplySync,
    },
    {
      layerId: 'vector-layer-id',
      install: vi.fn(),
      applySync: mocks.vectorApplySync,
    },
  ],
}))

type SyncInput = {
  manifest: CycleManifest
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  targetHourIndex: number
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

function createSyncInput(overrides: Partial<SyncInput> = {}): SyncInput {
  const manifest = overrides.manifest ?? createManifestFixture()
  return {
    manifest,
    activeScalar: manifest.scalarVariables[0],
    activeVector: manifest.vectorVariables[0],
    targetHourIndex: 0,
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
  const hourIndex = normalizeHourIndex(
    syncInput.targetHourIndex,
    syncInput.manifest.forecastHours.length
  )
  const hourToken = hourTokenAt(syncInput.manifest.forecastHours, hourIndex)

  return {
    manifest: syncInput.manifest,
    activeScalar: syncInput.activeScalar,
    activeVector: syncInput.activeVector,
    hourIndex,
    hourToken,
    requestKey: `${syncInput.manifest.cycle}:${syncInput.activeScalar}:${syncInput.activeVector}:${hourToken}:${retryToken}`,
    sync: syncInput.sync,
  }
}

describe('useSyncRunner + useStartupState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scalarApplySync.mockResolvedValue(undefined)
    mocks.vectorApplySync.mockResolvedValue(undefined)
  })

  it('does not sync when sync input is missing', async () => {
    const args = createBaseArgs({
      syncInput: null,
    })

    const { result } = renderHook(() => useSyncHarness(args))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.scalarApplySync).not.toHaveBeenCalled()
    expect(mocks.vectorApplySync).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')
    expect(result.current.startupErrorMessage).toBeNull()
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

    expect(mocks.scalarApplySync).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({
      ...args,
      syncInput,
    })

    await waitFor(() => {
      expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
      expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(0)
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
    expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
    expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
    expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const request = deferred<void>()
    mocks.scalarApplySync.mockImplementation(() => request.promise)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook(() => useSyncHarness(args))

    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(0)
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve()
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(0)
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('ignores abort errors (no onRequestError callback)', async () => {
    const abortError = new Error('Operation aborted')
    abortError.name = 'AbortError'

    mocks.scalarApplySync.mockRejectedValue(abortError)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
      expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)
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
    mocks.scalarApplySync
      .mockRejectedValueOnce(startupError)
      .mockResolvedValueOnce(undefined)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(0, startupError)
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })
    expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
    expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(mocks.scalarApplySync).toHaveBeenCalledTimes(2)
      expect(mocks.vectorApplySync).toHaveBeenCalledTimes(2)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(0)
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('forwards later sync errors without re-entering startup error', async () => {
    const laterError = new Error('later timeline error')
    mocks.scalarApplySync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(laterError)

    const args = createBaseArgs()
    const callbacks = args.syncInput?.sync as ForecastTimeSyncBridge
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(0)
      expect(result.current.startupPhase).toBe('ready')
    })

    rerender({
      ...args,
      syncInput: {
        ...(args.syncInput as SyncInput),
        targetHourIndex: 1,
      },
    })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(1, laterError)
    })
    expect(result.current.startupPhase).toBe('ready')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('forwards active scalar and active vector to adapters', async () => {
    const manifest = createManifestFixture({
      scalarVariables: ['rh_surface'],
      vectorVariables: ['gust10m_uv'],
    })
    const args = createBaseArgs({
      syncInput: createSyncInput({
        manifest,
        activeScalar: manifest.scalarVariables[0],
        activeVector: manifest.vectorVariables[0],
      }),
    })

    renderHook(() => useSyncHarness(args))

    await waitFor(() => {
      expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
      expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)
    })

    expect(mocks.scalarApplySync).toHaveBeenCalledWith(expect.objectContaining({
      activeScalar: 'rh_surface',
      activeVector: 'gust10m_uv',
    }))
    expect(mocks.vectorApplySync).toHaveBeenCalledWith(expect.objectContaining({
      activeScalar: 'rh_surface',
      activeVector: 'gust10m_uv',
    }))
  })

  it('resets startup state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    const observedSignals: AbortSignal[] = []
    mocks.scalarApplySync.mockImplementationOnce((args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return request.promise
    })

    const args = createBaseArgs()
    const { rerender, result } = renderHook((props: SyncHarnessArgs) => useSyncHarness(props), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(mocks.scalarApplySync).toHaveBeenCalledTimes(1)
      expect(mocks.vectorApplySync).toHaveBeenCalledTimes(1)
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
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createManifestFixture, createMapFixture } from '../test/fixtures'
import { hourTokenAt, normalizeHourIndex } from '../map/time/core'
import type {
  FrameSyncCallbacks,
  FrameSyncRequest,
  FrameSyncSelectionInput,
} from '../state/frameSyncTypes'
import { useFrameSyncRunner } from './useFrameSyncRunner'
import { useStartupSyncState } from './useStartupSyncState'

const mocks = vi.hoisted(() => ({
  scalarApplySync: vi.fn(),
  vectorApplySync: vi.fn(),
}))

vi.mock('../map/scalar', () => ({
  scalarLayerAdapter: {
    layerId: 'scalar-layer-id',
    createLayer: vi.fn(),
    applySync: mocks.scalarApplySync,
  },
}))

vi.mock('../map/vector', () => ({
  vectorLayerAdapter: {
    layerId: 'vector-layer-id',
    createLayer: vi.fn(),
    applySync: mocks.vectorApplySync,
  },
}))

type SyncInput = FrameSyncSelectionInput

type SyncHarnessArgs = {
  getMap: () => ReturnType<typeof createMapFixture> | null
  mapReadyVersion: number
  config: ReturnType<typeof createConfigFixture>
  syncInput: SyncInput | null
}

function useSyncHarness(args: SyncHarnessArgs) {
  const syncState = useStartupSyncState()
  const syncRequest = useMemo(
    () => buildSyncRequest(args.syncInput, syncState.retryToken),
    [args.syncInput, syncState.retryToken]
  )

  useFrameSyncRunner({
    getMap: args.getMap,
    mapReadyVersion: args.mapReadyVersion,
    config: args.config,
    syncRequest,
    syncState,
  })

  return syncState.status
}

function createSyncCallbacks(): FrameSyncCallbacks {
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
): FrameSyncRequest | null {
  if (!syncInput) return null
  const activeHourIndex = normalizeHourIndex(
    syncInput.targetHourIndex,
    syncInput.manifest.forecastHours.length
  )
  const hourToken = hourTokenAt(syncInput.manifest.forecastHours, activeHourIndex)

  return {
    manifest: syncInput.manifest,
    activeScalar: syncInput.activeScalar,
    activeVector: syncInput.activeVector,
    activeHourIndex,
    hourToken,
    syncKey: `${syncInput.manifest.cycle}:${syncInput.activeScalar}:${syncInput.activeVector}:${hourToken}:${retryToken}`,
    sync: syncInput.sync,
  }
}

describe('useFrameSyncRunner + useStartupSyncState', () => {
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
    const callbacks = args.syncInput?.sync as FrameSyncCallbacks

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
    const callbacks = args.syncInput?.sync as FrameSyncCallbacks
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
    const callbacks = args.syncInput?.sync as FrameSyncCallbacks
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
    const callbacks = args.syncInput?.sync as FrameSyncCallbacks
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
    const callbacks = args.syncInput?.sync as FrameSyncCallbacks
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

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConfigFixture,
  createDataSessionFixture,
  createForecastDataTargetFixture,
  createForecastTimeContextValue,
} from '@/test/fixtures'
import type { ForecastDataTarget } from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import type { InitialSyncController } from './initialSync'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useInitialSyncController: vi.fn(),
  useDataTarget: vi.fn(),
  useForecastTimeContext: vi.fn(),
  createForecastDataSession: vi.fn(),
  useRequestRunner: vi.fn(),
  useDataPrefetch: vi.fn(),
}))

vi.mock('./initialSync', () => ({
  useInitialSyncController: () => mocks.useInitialSyncController(),
}))

vi.mock('./useDataTarget', () => ({
  useDataTarget: () => mocks.useDataTarget(),
}))

vi.mock('@/forecast/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.useForecastTimeContext(),
  }
})

vi.mock('@/forecast/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/data')>()
  return {
    ...actual,
    createForecastDataSession: () => mocks.createForecastDataSession(),
  }
})

vi.mock('./useRequestRunner', () => ({
  useRequestRunner: (args: unknown) => mocks.useRequestRunner(args),
}))

vi.mock('./useDataPrefetch', () => ({
  useDataPrefetch: (args: unknown) => mocks.useDataPrefetch(args),
}))

function createInitialSyncController(
  overrides: Partial<InitialSyncController> = {}
): InitialSyncController {
  const retry = vi.fn()
  return {
    status: {
      phase: 'idle',
      errorMessage: null,
      retry,
    },
    retryToken: 0,
    isBlocked: false,
    handleDisabled: vi.fn(),
    handlePending: vi.fn(),
    handleApplied: vi.fn(),
    handleError: vi.fn(),
    ...overrides,
  }
}

function createDataTarget(overrides: Partial<ForecastDataTarget> = {}): ForecastDataTarget {
  return createForecastDataTargetFixture({ overrides })
}

type ForecastSyncArgs = Parameters<typeof useForecastSync>[0]

type ForecastSyncHarnessOptions = Partial<ForecastSyncArgs> & {
  initialSync?: InitialSyncController
  target?: ForecastDataTarget | null
  syncCallbacks?: ReturnType<typeof createForecastTimeContextValue>['syncCallbacks']
  dataSession?: ReturnType<typeof createDataSessionFixture>
}

function renderForecastSync(options: ForecastSyncHarnessOptions = {}) {
  const defaultRenderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
  const renderHost = options.renderHost === undefined ? defaultRenderHost : options.renderHost
  const config = options.config ?? createConfigFixture()
  const dataOptions = options.dataOptions ?? { pressure: true, windVectors: true }
  const initialSync = options.initialSync ?? createInitialSyncController()
  const target = 'target' in options ? options.target : createDataTarget()
  const syncCallbacks = options.syncCallbacks ?? createForecastTimeContextValue(null).syncCallbacks
  const dataSession = options.dataSession ?? createDataSessionFixture()

  mocks.useInitialSyncController.mockReturnValue(initialSync)
  mocks.useDataTarget.mockReturnValue(target)
  mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(null, {
    syncCallbacks,
  }))
  mocks.createForecastDataSession.mockReturnValue(dataSession)

  return {
    ...renderHook(() => useForecastSync({
      renderHost,
      config,
      dataOptions,
      onProbeFrameChange: options.onProbeFrameChange,
    })),
    renderHost,
    config,
    dataOptions,
    initialSync,
    target,
    syncCallbacks,
    dataSession,
    onProbeFrameChange: options.onProbeFrameChange,
  }
}

describe('useForecastSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createForecastDataSession.mockReturnValue(createDataSessionFixture())
    mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(null))
    mocks.useRequestRunner.mockReturnValue(undefined)
  })

  it('wires initial sync state into target composition, runner execution, prefetch, and return status', () => {
    const renderHost: ForecastRenderHost = { version: 3, apply: vi.fn() }
    const config = createConfigFixture()
    const initialSync = createInitialSyncController({ retryToken: 2 })
    const target = createDataTarget()
    const syncCallbacks = createForecastTimeContextValue(null).syncCallbacks
    const onProbeFrameChange = vi.fn()
    const dataSession = createDataSessionFixture()
    const dataOptions = { pressure: false, windVectors: true }

    const { result } = renderForecastSync({
      renderHost,
      config,
      initialSync,
      target,
      syncCallbacks,
      dataSession,
      dataOptions,
      onProbeFrameChange,
    })

    expect(mocks.useInitialSyncController).toHaveBeenCalledTimes(1)
    expect(mocks.useDataTarget).toHaveBeenCalledWith()
    expect(mocks.useRequestRunner).toHaveBeenCalledWith({
      renderHost,
      config,
      dataOptions,
      target,
      syncCallbacks,
      initialSync,
      dataSession,
      onProbeFrameChange,
    })
    expect(mocks.useDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: true,
      dataSession,
      dataOptions,
    })
    expect(result.current).toEqual({
      initialStatus: initialSync.status,
    })
  })

  it('passes null targets through to the sync runner', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const initialSync = createInitialSyncController()

    const { result } = renderForecastSync({
      renderHost,
      config,
      initialSync,
      target: null,
      dataOptions: { pressure: true, windVectors: true },
    })

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      initialSync,
      dataSession: expect.any(Object),
    }))
    expect(mocks.useDataPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      enabled: true,
      dataSession: expect.any(Object),
    }))
    expect(result.current).toEqual({
      initialStatus: initialSync.status,
    })
  })

  it('disables frame prefetch while initial sync is blocked', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const initialSync = createInitialSyncController({ isBlocked: true })
    const target = createDataTarget()

    renderForecastSync({
      renderHost,
      config,
      initialSync,
      target,
      dataOptions: { pressure: true, windVectors: true },
    })

    expect(mocks.useDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: false,
      dataSession: expect.any(Object),
      dataOptions: { pressure: true, windVectors: true },
    })
  })

  it('reuses one data session across rerenders', () => {
    const dataSession = createDataSessionFixture()
    const { rerender } = renderForecastSync({ dataSession })

    expect(mocks.createForecastDataSession).toHaveBeenCalledTimes(1)

    rerender()

    expect(mocks.createForecastDataSession).toHaveBeenCalledTimes(1)
    expect(mocks.useRequestRunner).toHaveBeenLastCalledWith(expect.objectContaining({
      dataSession,
    }))
    expect(mocks.useDataPrefetch).toHaveBeenLastCalledWith(expect.objectContaining({
      dataSession,
    }))
  })
})

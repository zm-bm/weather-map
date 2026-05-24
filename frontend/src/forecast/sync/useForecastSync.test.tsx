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
import type { StartupController } from './useStartupController'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useStartupController: vi.fn(),
  useDataTarget: vi.fn(),
  useForecastTimeContext: vi.fn(),
  createForecastDataSession: vi.fn(),
  useRequestRunner: vi.fn(),
  useDataPrefetch: vi.fn(),
}))

vi.mock('./useStartupController', () => ({
  useStartupController: () => mocks.useStartupController(),
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

function createStartupState(
  overrides: Partial<StartupController> = {}
): StartupController {
  const retry = vi.fn()
  return {
    status: {
      startupPhase: 'idle',
      startupErrorMessage: null,
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
  startup?: StartupController
  target?: ForecastDataTarget | null
  syncCallbacks?: ReturnType<typeof createForecastTimeContextValue>['syncCallbacks']
  dataSession?: ReturnType<typeof createDataSessionFixture>
}

function renderForecastSync(options: ForecastSyncHarnessOptions = {}) {
  const defaultRenderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
  const renderHost = options.renderHost === undefined ? defaultRenderHost : options.renderHost
  const config = options.config ?? createConfigFixture()
  const dataOptions = options.dataOptions ?? { pressure: true, windVectors: true }
  const startup = options.startup ?? createStartupState()
  const target = 'target' in options ? options.target : createDataTarget()
  const syncCallbacks = options.syncCallbacks ?? createForecastTimeContextValue(null).syncCallbacks
  const dataSession = options.dataSession ?? createDataSessionFixture()

  mocks.useStartupController.mockReturnValue(startup)
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
    startup,
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

  it('wires startup state into target composition, runner execution, prefetch, and return status', () => {
    const renderHost: ForecastRenderHost = { version: 3, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState({ retryToken: 2 })
    const target = createDataTarget()
    const syncCallbacks = createForecastTimeContextValue(null).syncCallbacks
    const onProbeFrameChange = vi.fn()
    const dataSession = createDataSessionFixture()
    const dataOptions = { pressure: false, windVectors: true }

    const { result } = renderForecastSync({
      renderHost,
      config,
      startup,
      target,
      syncCallbacks,
      dataSession,
      dataOptions,
      onProbeFrameChange,
    })

    expect(mocks.useStartupController).toHaveBeenCalledTimes(1)
    expect(mocks.useDataTarget).toHaveBeenCalledWith()
    expect(mocks.useRequestRunner).toHaveBeenCalledWith({
      renderHost,
      config,
      dataOptions,
      target,
      syncCallbacks,
      startup,
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
      startupStatus: startup.status,
    })
  })

  it('passes null targets through to the sync runner', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()

    const { result } = renderForecastSync({
      renderHost,
      config,
      startup,
      target: null,
      dataOptions: { pressure: true, windVectors: true },
    })

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      startup,
      dataSession: expect.any(Object),
    }))
    expect(mocks.useDataPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      enabled: true,
      dataSession: expect.any(Object),
    }))
    expect(result.current).toEqual({
      startupStatus: startup.status,
    })
  })

  it('disables frame prefetch while startup is blocked', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState({ isBlocked: true })
    const target = createDataTarget()

    renderForecastSync({
      renderHost,
      config,
      startup,
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
})

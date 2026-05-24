import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'

import {
  createConfigFixture,
  createDataLoadJobFixture,
  createDataSessionFixture,
  createDeferred,
  createFieldWindowFixture,
  createForecastDataTargetFixture,
  createLoadedForecastDataFixture,
  createWindVectorWindowFixture,
} from '@/test/fixtures'
import type { ForecastTimeSyncCallbacks } from '@/forecast/time'
import {
  DEFAULT_FORECAST_DATA_OPTIONS,
  type FieldInterpolationWindowData,
  type ForecastDataOptions,
  type ForecastDataSession,
  type ForecastDataTarget,
  type LoadedForecastData,
} from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import { useRequestRunner } from './useRequestRunner'
import { useStartupController } from './useStartupController'

export const runnerMocks = {
  createLoadJob: vi.fn(),
  loadJob: vi.fn(),
  commitJob: vi.fn(),
  resetSession: vi.fn(),
  applyRenderData: vi.fn(),
  fieldWindow: createFieldWindowFixture(),
  particleWindow: createWindVectorWindowFixture(),
}

export type RequestRunnerHarnessArgs = {
  renderHost: ForecastRenderHost | null
  config: ReturnType<typeof createConfigFixture>
  target: ForecastDataTarget | null
  syncCallbacks: ForecastTimeSyncCallbacks
  dataSession: ForecastDataSession
  dataOptions?: ForecastDataOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export function useRequestRunnerHarness(args: RequestRunnerHarnessArgs) {
  const startup = useStartupController()

  useRequestRunner({
    renderHost: args.renderHost,
    config: args.config,
    target: args.target,
    syncCallbacks: args.syncCallbacks,
    startup,
    dataSession: args.dataSession,
    dataOptions: args.dataOptions ?? DEFAULT_FORECAST_DATA_OPTIONS,
    onProbeFrameChange: args.onProbeFrameChange,
  })

  return {
    ...startup.status,
  }
}

export function renderRequestRunnerHarness(args: RequestRunnerHarnessArgs) {
  return renderHook(
    (props: RequestRunnerHarnessArgs) => useRequestRunnerHarness(props),
    { initialProps: args },
  )
}

export function resetRequestRunnerMocks() {
  vi.clearAllMocks()
  runnerMocks.fieldWindow = createFieldWindowFixture()
  runnerMocks.particleWindow = createWindVectorWindowFixture()
  runnerMocks.loadJob.mockResolvedValue(createRunnerLoadedData())
  runnerMocks.createLoadJob.mockImplementation(createDefaultLoadJob)
  runnerMocks.applyRenderData.mockReturnValue(undefined)
}

export function createSyncCallbacks(): ForecastTimeSyncCallbacks {
  return {
    onRequestStart: vi.fn(),
    onRequestApplied: vi.fn(),
    onRequestError: vi.fn(),
  }
}

export function createBaseRunnerArgs(
  overrides: Partial<RequestRunnerHarnessArgs> = {}
): RequestRunnerHarnessArgs {
  return {
    renderHost: { version: 1, apply: runnerMocks.applyRenderData },
    config: createConfigFixture(),
    target: createForecastDataTargetFixture(),
    syncCallbacks: createSyncCallbacks(),
    dataSession: createRunnerDataSessionFixture(),
    onProbeFrameChange: vi.fn(),
    ...overrides,
  }
}

export function createRunnerDataSessionFixture(
  overrides: Partial<ForecastDataSession> = {}
): ForecastDataSession {
  return createDataSessionFixture({
    createLoadJob: runnerMocks.createLoadJob,
    reset: runnerMocks.resetSession,
    ...overrides,
  })
}

export function createRunnerLoadJobFixture(overrides: {
  key?: string
  selectedValidTimeMs?: number
  shouldClearProbeFrame?: boolean
  load?: () => Promise<LoadedForecastData>
  commit?: (data: LoadedForecastData) => void
} = {}) {
  return createDataLoadJobFixture({
    load: runnerMocks.loadJob,
    commit: runnerMocks.commitJob,
    ...overrides,
  })
}

export function createDefaultLoadJob(args: {
  target: ForecastDataTarget
  retryToken: number
}) {
  return createRunnerLoadJobFixture({
    key: `job:${args.target.selectedValidTimeMs}:${args.retryToken}`,
    selectedValidTimeMs: args.target.selectedValidTimeMs,
  })
}

export function createLoadJobSignal(index: number): AbortSignal {
  const signal = runnerMocks.createLoadJob.mock.calls[index]?.[0]?.signal
  if (!(signal instanceof AbortSignal)) {
    throw new Error(`Missing createLoadJob signal ${index}`)
  }
  return signal
}

export function targetAt(
  target: ForecastDataTarget,
  index: number,
  overrides: Partial<ForecastDataTarget> = {},
): ForecastDataTarget {
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

export function createRunnerLoadedData(overrides: {
  field?: unknown
  cloudLayers?: unknown | null
  probeField?: unknown | null
  precipType?: unknown | null
  pressure?: unknown | null
  windVectors?: unknown | null
} = {}): LoadedForecastData {
  return createLoadedForecastDataFixture({
    field: overrides.field === undefined
      ? runnerMocks.fieldWindow
      : overrides.field as LoadedForecastData['windows']['field'],
    cloudLayers: overrides.cloudLayers as LoadedForecastData['windows']['cloudLayers'],
    precipType: overrides.precipType as LoadedForecastData['windows']['precipType'],
    pressure: overrides.pressure as LoadedForecastData['windows']['pressure'],
    windVectors: overrides.windVectors === undefined
      ? runnerMocks.particleWindow
      : overrides.windVectors as LoadedForecastData['windows']['windVectors'],
    probeField: overrides.probeField === undefined
      ? runnerMocks.fieldWindow
      : overrides.probeField as FieldInterpolationWindowData | null,
  })
}

export const deferred = createDeferred

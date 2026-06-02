import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'

import {
  createConfigFixture,
  createForecastLoadJobFixture,
  createForecastSyncSessionFixture,
  createDeferred,
  createRasterWindowFixture,
  createForecastSyncPlanFixture,
  createForecastWindowsFixture,
  createParticlesWindowFixture,
} from '@/test/fixtures'
import type { ForecastTimeSyncCallbacks } from '@/forecast/time'
import type { ForecastSyncSession } from '../load/session'
import type { ForecastSyncPlan } from '../plan'
import type {
  ForecastWindows,
  ProbeWindow,
} from '@/forecast/frames'
import type { ForecastRenderHost } from '@/forecast/render'
import { useRequestRunner } from './useRequestRunner'
import { useInitialSyncController } from './initialSync'

export const runnerMocks = {
  createLoadJob: vi.fn(),
  loadJob: vi.fn(),
  commitJob: vi.fn(),
  resetSession: vi.fn(),
  applyRenderWindows: vi.fn(),
  rasterWindow: createRasterWindowFixture(),
  particleWindow: createParticlesWindowFixture(),
}

export type RequestRunnerHarnessArgs = {
  renderHost: ForecastRenderHost | null
  config: ReturnType<typeof createConfigFixture>
  plan: ForecastSyncPlan | null
  syncCallbacks: ForecastTimeSyncCallbacks
  syncSession: ForecastSyncSession
  onProbeFrameChange?: (frame: ProbeWindow | null) => void
}

export function useRequestRunnerHarness(args: RequestRunnerHarnessArgs) {
  const initialSync = useInitialSyncController()

  useRequestRunner({
    renderHost: args.renderHost,
    config: args.config,
    plan: args.plan,
    syncCallbacks: args.syncCallbacks,
    initialSync,
    syncSession: args.syncSession,
    onProbeFrameChange: args.onProbeFrameChange,
  })

  return {
    ...initialSync.status,
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
  runnerMocks.rasterWindow = createRasterWindowFixture()
  runnerMocks.particleWindow = createParticlesWindowFixture()
  runnerMocks.loadJob.mockResolvedValue(createRunnerWindows())
  runnerMocks.createLoadJob.mockImplementation(createDefaultLoadJob)
  runnerMocks.applyRenderWindows.mockReturnValue(undefined)
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
    renderHost: { version: 1, apply: runnerMocks.applyRenderWindows },
    config: createConfigFixture(),
    plan: createForecastSyncPlanFixture(),
    syncCallbacks: createSyncCallbacks(),
    syncSession: createRunnerSyncSessionFixture(),
    onProbeFrameChange: vi.fn(),
    ...overrides,
  }
}

export function createRunnerSyncSessionFixture(
  overrides: Partial<ForecastSyncSession> = {}
): ForecastSyncSession {
  return createForecastSyncSessionFixture({
    createLoadJob: runnerMocks.createLoadJob,
    reset: runnerMocks.resetSession,
    ...overrides,
  })
}

export function createRunnerLoadJobFixture(overrides: {
  key?: string
  selectedValidTimeMs?: number
  shouldClearProbeFrame?: boolean
  load?: () => Promise<ForecastWindows>
  commit?: (windows: ForecastWindows) => void
} = {}) {
  return createForecastLoadJobFixture({
    load: runnerMocks.loadJob,
    commit: runnerMocks.commitJob,
    ...overrides,
  })
}

export function createDefaultLoadJob(args: {
  plan: ForecastSyncPlan
  retryToken: number
}) {
  return createRunnerLoadJobFixture({
    key: `job:${args.plan.selectedValidTimeMs}:${args.retryToken}`,
    selectedValidTimeMs: args.plan.selectedValidTimeMs,
  })
}

export function createLoadJobSignal(index: number): AbortSignal {
  const signal = runnerMocks.createLoadJob.mock.calls[index]?.[0]?.signal
  if (!(signal instanceof AbortSignal)) {
    throw new Error(`Missing createLoadJob signal ${index}`)
  }
  return signal
}

export function planAt(
  plan: ForecastSyncPlan,
  index: number,
  overrides: Partial<ForecastSyncPlan> = {},
): ForecastSyncPlan {
  const validTime = plan.activeRun.latest.frames[index]
  if (!validTime) throw new Error(`Missing fixture time at index ${index}`)
  return createForecastSyncPlanFixture({
    activeRun: plan.activeRun,
    targetTimeMs: Date.parse(validTime.valid_at),
    overrides: {
      windowPlans: plan.windowPlans,
      ...overrides,
    },
  })
}

export function createRunnerWindows(overrides: {
  raster?: unknown | null
  overlay?: unknown | null
  contour?: unknown | null
  particles?: unknown | null
} = {}): ForecastWindows {
  return createForecastWindowsFixture({
    raster: overrides.raster === undefined
      ? runnerMocks.rasterWindow
      : overrides.raster as ForecastWindows['raster'],
    overlay: overrides.overlay as ForecastWindows['overlay'],
    contour: overrides.contour as ForecastWindows['contour'],
    particles: overrides.particles === undefined
      ? runnerMocks.particleWindow
      : overrides.particles as ForecastWindows['particles'],
  })
}

export const deferred = createDeferred

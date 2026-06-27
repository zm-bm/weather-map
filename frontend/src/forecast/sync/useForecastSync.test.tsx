import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createConfigFixture,
  createForecastSyncSessionFixture,
  createForecastTimeContextValue,
  createDeferred,
  createForecastSelectionContextValue,
  createManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '@/test/fixtures'
import { getDisplayProfile } from '@/forecast/display'
import type { ForecastRenderHost } from '@/forecast/render'
import type { ForecastSyncPlan } from './plan'
import type { InitialSyncController } from './request/initialSync'
import { resolvePrefetchAheadFrameCount, useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useInitialSyncController: vi.fn(),
  useForecastSelectionContext: vi.fn(),
  useForecastTimeContext: vi.fn(),
  resolveForecastSyncPlan: vi.fn(),
  createForecastSyncSession: vi.fn(),
  useRequestRunner: vi.fn(),
}))

vi.mock('./request/initialSync', () => ({
  useInitialSyncController: () => mocks.useInitialSyncController(),
}))

vi.mock('@/forecast/selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/selection')>()
  return {
    ...actual,
    useForecastSelectionContext: () => mocks.useForecastSelectionContext(),
  }
})

vi.mock('@/forecast/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.useForecastTimeContext(),
  }
})

vi.mock('./load/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./load/session')>()
  return {
    ...actual,
    createForecastSyncSession: () => mocks.createForecastSyncSession(),
  }
})

vi.mock('./request/useRequestRunner', () => ({
  useRequestRunner: (args: unknown) => mocks.useRequestRunner(args),
}))

vi.mock('./plan', () => ({
  resolveForecastSyncPlan: (args: unknown) => mocks.resolveForecastSyncPlan(args),
}))

const MIB = 1024 * 1024

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

type ForecastSyncArgs = Parameters<typeof useForecastSync>[0]

type ForecastSyncHarnessOptions = Partial<ForecastSyncArgs> & {
  initialSync?: InitialSyncController
  plan?: ForecastSyncPlan | null
  syncCallbacks?: ReturnType<typeof createForecastTimeContextValue>['syncCallbacks']
  syncSession?: ReturnType<typeof createForecastSyncSessionFixture>
  targetTimeMs?: number
}

function createHookPlanFixture(overrides: Partial<ForecastSyncPlan> = {}): ForecastSyncPlan {
  const activeRun = createActiveRunFixture(createManifestFixture({
    cycle: '2026040900',
    frameIds: ['000', '003', '006'],
  }))
  const rasterWindowKey = 'test:raster:temperature'

  return {
    activeRun,
    frameIds: ['000', '003', '006'],
    windowPlans: [{
      id: 'raster',
      key: rasterWindowKey,
      failurePolicy: 'required',
      frames: [{
        source: {
          layerId: 'temperature',
          artifactId: 'tmp_surface',
          display: getDisplayProfile('temperature'),
          overlays: [],
          bands: [{ id: 'value' }],
        },
        artifactId: 'tmp_surface',
        bandIds: ['value'],
        cacheKeyPrefix: rasterWindowKey,
      }],
    }],
    selectedValidTimeMs: Date.UTC(2026, 3, 9, 3),
    lowerFrameId: '003',
    upperFrameId: '006',
    mix: 0,
    minuteOffset: 0,
    ...overrides,
  }
}

function createTemperatureWindPlanFixture(args: {
  temperatureBytes: number
  windBytes: number
}): ForecastSyncPlan {
  const activeRun = createActiveRunFixture(createManifestFixture({
    cycle: '2026040900',
    frameIds: ['000', '003', '006', '009', '012', '015', '018', '021', '024'],
    artifacts: {
      tmp_surface: createScalarArtifactFixture({
        id: 'tmp_surface',
        byte_length: args.temperatureBytes,
      }),
      wind10m_uv: createVectorArtifactFixture({
        id: 'wind10m_uv',
        components: ['u', 'v'],
        byte_length: args.windBytes,
      }),
    },
  }))

  return createHookPlanFixture({
    activeRun,
    frameIds: ['000', '003', '006', '009', '012', '015', '018', '021', '024'],
    windowPlans: [
      {
        id: 'raster',
        key: 'test:raster:temperature',
        failurePolicy: 'required',
        frames: [{
          source: {
            layerId: 'temperature',
            artifactId: 'tmp_surface',
            display: getDisplayProfile('temperature'),
            overlays: [],
            bands: [{ id: 'value' }],
          },
          artifactId: 'tmp_surface',
          bandIds: ['value'],
          cacheKeyPrefix: 'test:raster:temperature',
        }],
      },
      {
        id: 'particles',
        key: 'test:particles:wind',
        failurePolicy: 'required',
        frames: [{
          source: {
            id: 'wind',
            label: 'Wind',
            source: {
              artifactId: 'wind10m_uv',
              bands: [{ id: 'u' }, { id: 'v' }],
            },
          },
          artifactId: 'wind10m_uv',
          bandIds: ['u', 'v'],
          cacheKeyPrefix: 'test:particles:wind',
        }],
      },
    ],
  })
}

function renderForecastSync(options: ForecastSyncHarnessOptions = {}) {
  const defaultRenderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
  const manifest = createManifestFixture({
    cycle: '2026040900',
    frameIds: ['000', '003', '006'],
  })
  const renderHost = options.renderHost === undefined ? defaultRenderHost : options.renderHost
  const config = options.config ?? createConfigFixture()
  const syncOptions = options.syncOptions ?? { contour: false, particles: true }
  const initialSync = options.initialSync ?? createInitialSyncController()
  const plan = 'plan' in options ? options.plan : createHookPlanFixture()
  const syncCallbacks = options.syncCallbacks ?? createForecastTimeContextValue(null).syncCallbacks
  const syncSession = options.syncSession ?? createForecastSyncSessionFixture({
    prefetch: vi.fn().mockResolvedValue(undefined),
  })
  const onFieldLoadingChange = options.onFieldLoadingChange
  const targetTimeMs = options.targetTimeMs ?? Date.UTC(2026, 3, 9, 3, 30)

  mocks.useInitialSyncController.mockReturnValue(initialSync)
  mocks.useForecastSelectionContext.mockReturnValue(createForecastSelectionContextValue(manifest))
  mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(manifest, {
    state: {
      appliedTimeMs: targetTimeMs,
      targetTimeMs,
    },
    syncCallbacks,
  }))
  mocks.resolveForecastSyncPlan.mockReturnValue(plan)
  mocks.createForecastSyncSession.mockReturnValue(syncSession)

  return {
    ...renderHook(() => useForecastSync({
      renderHost,
      config,
      syncOptions,
      onProbeFrameChange: options.onProbeFrameChange,
      onFieldLoadingChange,
    })),
    renderHost,
    config,
    syncOptions,
    initialSync,
    plan,
    targetTimeMs,
    syncCallbacks,
    syncSession,
    onProbeFrameChange: options.onProbeFrameChange,
    onFieldLoadingChange,
  }
}

describe('useForecastSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createForecastSyncSession.mockReturnValue(createForecastSyncSessionFixture())
    mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(null))
    mocks.useRequestRunner.mockReturnValue(undefined)
    mocks.resolveForecastSyncPlan.mockReturnValue(createHookPlanFixture())
  })

  it('uses a byte-budgeted lookahead that favors smaller GFS frames over ICON frames', () => {
    const gfsSizedPlan = createTemperatureWindPlanFixture({
      temperatureBytes: 1 * MIB,
      windBytes: 2 * MIB,
    })
    const iconSizedPlan = createTemperatureWindPlanFixture({
      temperatureBytes: 4 * MIB,
      windBytes: 8 * MIB,
    })

    expect(resolvePrefetchAheadFrameCount(gfsSizedPlan)).toBe(8)
    expect(resolvePrefetchAheadFrameCount(iconSizedPlan)).toBe(2)
  })

  it('clamps byte-budgeted lookahead to the configured min and max frame counts', () => {
    expect(resolvePrefetchAheadFrameCount(createTemperatureWindPlanFixture({
      temperatureBytes: 256 * 1024,
      windBytes: 256 * 1024,
    }))).toBe(8)
    expect(resolvePrefetchAheadFrameCount(createTemperatureWindPlanFixture({
      temperatureBytes: 32 * MIB,
      windBytes: 32 * MIB,
    }))).toBe(2)
  })

  it('counts duplicate planned artifacts once when estimating prefetch bytes', () => {
    const plan = createTemperatureWindPlanFixture({
      temperatureBytes: 4 * MIB,
      windBytes: 4 * MIB,
    })
    const duplicateFrame = plan.windowPlans[0]!.frames[0]!
    const duplicateTemperaturePlan: ForecastSyncPlan = {
      ...plan,
      windowPlans: [
        ...plan.windowPlans,
        {
          ...plan.windowPlans[0]!,
          key: 'duplicate:temperature',
          frames: [{
            ...duplicateFrame,
            cacheKeyPrefix: 'duplicate:temperature',
          }],
        },
      ],
    }

    expect(resolvePrefetchAheadFrameCount(duplicateTemperaturePlan)).toBe(4)
  })

  it('composes the plan, wires request execution, starts prefetch, and returns initial status', async () => {
    const renderHost: ForecastRenderHost = { version: 3, apply: vi.fn() }
    const config = createConfigFixture()
    const initialSync = createInitialSyncController({ retryToken: 2 })
    const plan = createHookPlanFixture()
    const syncCallbacks = createForecastTimeContextValue(null).syncCallbacks
    const onProbeFrameChange = vi.fn()
    const onFieldLoadingChange = vi.fn()
    const syncSession = createForecastSyncSessionFixture({ prefetch: vi.fn().mockResolvedValue(undefined) })
    const syncOptions = { contour: false, particles: true }

    const { result } = renderForecastSync({
      renderHost,
      config,
      initialSync,
      plan,
      syncCallbacks,
      syncSession,
      syncOptions,
      onProbeFrameChange,
      onFieldLoadingChange,
    })

    expect(mocks.useInitialSyncController).toHaveBeenCalledTimes(1)
    expect(mocks.resolveForecastSyncPlan).toHaveBeenCalledWith(expect.objectContaining({
      activeRun: expect.any(Object),
      selectedLayerId: 'temperature',
      targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
      syncOptions,
    }))
    expect(mocks.useRequestRunner).toHaveBeenCalledWith({
      renderHost,
      config,
      plan,
      syncCallbacks,
      initialSync,
      syncSession,
      onProbeFrameChange,
      onFieldLoadingChange,
    })
    await waitFor(() => {
      expect(syncSession.prefetch).toHaveBeenCalledTimes(1)
    })
    expect(syncSession.prefetch).toHaveBeenCalledWith(expect.objectContaining({
      plan,
      config,
      aheadFrameCount: 8,
      concurrency: 2,
      signal: expect.any(AbortSignal),
    }))
    expect(result.current).toEqual({
      initialStatus: initialSync.status,
    })
  })

  it('passes null plans through to the sync runner', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const initialSync = createInitialSyncController()

    const { result } = renderForecastSync({
      renderHost,
      config,
      initialSync,
      plan: null,
      syncOptions: { contour: true, particles: true },
    })

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      plan: null,
      initialSync,
      syncSession: expect.any(Object),
    }))
    expect((mocks.createForecastSyncSession.mock.results[0]?.value as ReturnType<typeof createForecastSyncSessionFixture>).prefetch)
      .not.toHaveBeenCalled()
    expect(result.current).toEqual({
      initialStatus: initialSync.status,
    })
  })

  it('disables frame prefetch while initial sync is blocked', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const initialSync = createInitialSyncController({ isBlocked: true })
    const syncSession = createForecastSyncSessionFixture({ prefetch: vi.fn().mockResolvedValue(undefined) })

    renderForecastSync({
      renderHost,
      config,
      initialSync,
      syncSession,
      syncOptions: { contour: true, particles: true },
    })

    expect(syncSession.prefetch).not.toHaveBeenCalled()
  })

  it('reuses one loading session across rerenders', () => {
    const syncSession = createForecastSyncSessionFixture({
      prefetch: vi.fn().mockResolvedValue(undefined),
    })
    const { rerender } = renderForecastSync({ syncSession })

    expect(mocks.createForecastSyncSession).toHaveBeenCalledTimes(1)

    rerender()

    expect(mocks.createForecastSyncSession).toHaveBeenCalledTimes(1)
    expect(mocks.useRequestRunner).toHaveBeenLastCalledWith(expect.objectContaining({
      syncSession,
    }))
  })

  it('keeps queued prefetch work when playback moves inside the same frame window', async () => {
    const observedSignals: AbortSignal[] = []
    const pendingPrefetch = createDeferred<void>()
    const syncSession = createForecastSyncSessionFixture({
      prefetch: vi.fn((args: { signal: AbortSignal }) => {
        observedSignals.push(args.signal)
        return pendingPrefetch.promise
      }),
    })
    const firstTarget = createHookPlanFixture({
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 5),
      lowerFrameId: '003',
      upperFrameId: '006',
      minuteOffset: 5,
    })
    const secondTarget = createHookPlanFixture({
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 10),
      lowerFrameId: '003',
      upperFrameId: '006',
      minuteOffset: 10,
    })
    const { rerender } = renderForecastSync({
      plan: firstTarget,
      syncSession,
      targetTimeMs: Date.UTC(2026, 3, 9, 3, 5),
    })
    await waitFor(() => {
      expect(syncSession.prefetch).toHaveBeenCalledTimes(1)
    })

    mocks.resolveForecastSyncPlan.mockReturnValue(secondTarget)
    mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(null, {
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 3, 10),
        targetTimeMs: Date.UTC(2026, 3, 9, 3, 10),
      },
    }))
    rerender()

    expect(syncSession.prefetch).toHaveBeenCalledTimes(1)
    expect(observedSignals[0]?.aborted).toBe(false)
  })

  it('aborts queued prefetch work when target frame dependencies change', async () => {
    const observedSignals: AbortSignal[] = []
    const pendingPrefetch = createDeferred<void>()
    const syncSession = createForecastSyncSessionFixture({
      prefetch: vi.fn((args: { signal: AbortSignal }) => {
        observedSignals.push(args.signal)
        return pendingPrefetch.promise
      }),
    })
    const firstTarget = createHookPlanFixture()
    const secondTarget = createHookPlanFixture({
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 6),
      lowerFrameId: '006',
      upperFrameId: '006',
    })
    const firstTargetTimeMs = Date.UTC(2026, 3, 9, 3, 30)
    const secondTargetTimeMs = Date.UTC(2026, 3, 9, 6)
    const { rerender } = renderForecastSync({
      plan: firstTarget,
      syncSession,
      targetTimeMs: firstTargetTimeMs,
    })
    await waitFor(() => {
      expect(syncSession.prefetch).toHaveBeenCalledTimes(1)
    })

    mocks.resolveForecastSyncPlan.mockReturnValue(secondTarget)
    mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(null, {
      state: {
        appliedTimeMs: secondTargetTimeMs,
        targetTimeMs: secondTargetTimeMs,
      },
    }))
    rerender()

    expect(observedSignals[0]?.aborted).toBe(true)
  })

  it('suppresses prefetch failures', async () => {
    const syncSession = createForecastSyncSessionFixture({
      prefetch: vi.fn().mockRejectedValue(new Error('prefetch failed')),
    })

    renderForecastSync({ syncSession })

    await waitFor(() => {
      expect(syncSession.prefetch).toHaveBeenCalledTimes(1)
    })
  })
})

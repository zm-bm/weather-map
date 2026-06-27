import { vi } from 'vitest'

import type {
  ForecastSyncOptions,
  ForecastSyncPlan,
} from '@/forecast/sync/plan'
import { resolveForecastSyncPlan } from '@/forecast/sync/plan'
import type { ForecastSyncSession } from '@/forecast/sync/load/session'
import type { ActiveForecastRun } from '@/forecast/manifest'
import {
  normalizeFrameId,
} from '@/forecast/manifest'
import {
  interpolationWindowMinuteOffset,
  type ForecastInterpolationWindow,
} from '@/forecast/time'
import type {
  ContourSource,
  ForecastLayerSource,
  ParticleSource,
} from '@/forecast/catalog/source'
import type { ForecastWindows } from '@/forecast/frames'
import {
  createActiveRunFixture,
  createManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from './manifest'

type ForecastSyncPlanFixtureOptions = {
  contour: boolean
  particles: boolean
}

export function createForecastSyncPlanFixture(args: {
  activeRun?: ActiveForecastRun
  selectedLayerId?: string | null
  layerSource?: ForecastLayerSource
  contourSource?: ContourSource | null
  particleSource?: ParticleSource | null
  syncOptions?: Partial<ForecastSyncPlanFixtureOptions>
  interpolationWindow?: ForecastInterpolationWindow
  targetTimeMs?: number
  overrides?: Partial<ForecastSyncPlan>
} = {}): ForecastSyncPlan {
  const activeRun = args.activeRun ?? createDefaultForecastSyncPlanActiveRun(args)
  const firstTime = activeRun.latest.frames[0]
  if (firstTime == null) throw new Error('Forecast sync plan fixture requires at least one time')

  const targetTimeMs = args.targetTimeMs ??
    args.interpolationWindow?.selectedValidTimeMs ??
    Date.parse(firstTime.valid_at)
  const syncOptions: ForecastSyncOptions = {
    contour: true,
    particles: true,
    ...args.syncOptions,
  }
  if (args.contourSource === null) syncOptions.contour = false
  if (args.particleSource === null) syncOptions.particles = false

  const plan = resolveForecastSyncPlan({
    activeRun,
    selectedLayerId: args.selectedLayerId === undefined
      ? args.layerSource?.layerId ?? 'temperature'
      : args.selectedLayerId,
    targetTimeMs,
    syncOptions,
  })
  if (plan == null) throw new Error('Forecast sync plan fixture could not resolve a plan')

  if (args.interpolationWindow == null) {
    return {
      ...plan,
      ...args.overrides,
    }
  }

  return {
    ...plan,
    selectedValidTimeMs: args.interpolationWindow.selectedValidTimeMs,
    lowerFrameId: normalizeFrameId(args.interpolationWindow.lowerFrameId),
    upperFrameId: normalizeFrameId(args.interpolationWindow.upperFrameId),
    mix: args.interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(args.interpolationWindow),
    ...args.overrides,
  }
}

function createDefaultForecastSyncPlanActiveRun(args: {
  layerSource?: ForecastLayerSource
  contourSource?: ContourSource | null
  particleSource?: ParticleSource | null
}): ActiveForecastRun {
  const artifacts: Record<
    string,
    ReturnType<typeof createScalarArtifactFixture> | ReturnType<typeof createVectorArtifactFixture>
  > = {
    tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
    wind10m_uv: createVectorArtifactFixture({ id: 'wind10m_uv', components: ['u', 'v'] }),
  }

  addSourceArtifact(artifacts, args.layerSource)
  for (const overlay of args.layerSource?.overlays ?? []) {
    addSourceArtifact(artifacts, overlay.source)
  }
  if (args.contourSource !== null) {
    addSourceArtifact(artifacts, args.contourSource?.source)
  }
  if (args.particleSource !== null) {
    addSourceArtifact(artifacts, args.particleSource?.source)
  }

  return createActiveRunFixture(createManifestFixture({ artifacts }))
}

function addSourceArtifact(
  artifacts: Record<string, ReturnType<typeof createScalarArtifactFixture> | ReturnType<typeof createVectorArtifactFixture>>,
  source: { artifactId: string; bands: readonly { id: string }[] } | undefined,
): void {
  if (source == null || artifacts[source.artifactId] != null) return
  const bandIds = source.bands.map((band) => band.id)
  artifacts[source.artifactId] = bandIds.length === 1 && bandIds[0] === 'value'
    ? createScalarArtifactFixture({ id: source.artifactId })
    : createVectorArtifactFixture({ id: source.artifactId, components: bandIds })
}

export function createForecastLoadJobFixture(args: {
  key?: string
  selectedValidTimeMs?: number
  shouldClearProbeFrame?: boolean
  load?: () => Promise<ForecastWindows>
  commit?: (windows: ForecastWindows) => void
} = {}) {
  return {
    key: args.key ?? 'job:default',
    selectedValidTimeMs: args.selectedValidTimeMs ?? Date.UTC(2026, 3, 13, 12),
    shouldClearProbeFrame: args.shouldClearProbeFrame ?? false,
    load: args.load ?? vi.fn(),
    commit: args.commit ?? vi.fn(),
  }
}

export function createForecastSyncSessionFixture(
  overrides: Partial<ForecastSyncSession> = {}
): ForecastSyncSession {
  return {
    createLoadJob: vi.fn(),
    prefetch: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

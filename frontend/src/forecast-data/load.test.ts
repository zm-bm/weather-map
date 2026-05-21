import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createManifestFixture,
} from '../test/fixtures'
import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  type LayerSpec,
  type ParticleLayerSpec,
} from '../forecast-catalog'
import { createForecastDataTarget, type ForecastDataTarget } from './target'
import type { ForecastDataPlan } from './plan'
import { loadForecastData } from './load'

const loaders = {
  field: vi.fn(),
  precipTypeOverlay: vi.fn(),
  pressureContours: vi.fn(),
  particles: vi.fn(),
}

function createTarget(args: {
  manifest: ReturnType<typeof createManifestFixture>
  selectedLayer?: LayerSpec
  selectedParticleLayer?: ParticleLayerSpec | null
  selectedValidTimeMs?: number
  lowerHourToken?: string
  upperHourToken?: string
  mix?: number
}): ForecastDataTarget {
  const activeRun = createActiveRunFixture(args.manifest)
  const selectedLayer = args.selectedLayer ?? FORECAST_LAYERS_BY_ID.temperature!
  const selectedParticleLayer = args.selectedParticleLayer === undefined
    ? (getAvailableParticleLayers(activeRun).wind ?? null)
    : args.selectedParticleLayer

  return createForecastDataTarget({
    activeRun,
    selectedLayerId: selectedLayer.id,
    selectedLayer,
    selectedParticleLayerId: selectedParticleLayer?.id ?? null,
    selectedParticleLayer,
    interpolationWindow: {
      selectedValidTimeMs: args.selectedValidTimeMs ?? 123,
      lowerHourToken: args.lowerHourToken ?? '000',
      upperHourToken: args.upperHourToken ?? '003',
      lowerValidTimeMs: 0,
      upperValidTimeMs: 180 * 60 * 1000,
      mix: args.mix ?? 0.5,
    },
    retryToken: 0,
  })
}

function createPlan(target: ForecastDataTarget, args: {
  includeOverlay?: boolean
  includeContours?: boolean
  includeParticles?: boolean
} = {}): ForecastDataPlan {
  const field = {
    key: 'field:key',
    load: loaders.field,
  }
  const precipTypeOverlay = args.includeOverlay === true
    ? {
      key: 'precip-type-overlay:key',
      load: loaders.precipTypeOverlay,
    }
    : null
  const pressureContours = args.includeContours === true
    ? {
      key: 'pressure-contours:key',
      load: loaders.pressureContours,
    }
    : null
  const particles = args.includeParticles === false
    ? null
    : {
      key: 'particles:key',
      load: loaders.particles,
    }

  return {
    activeRun: target.activeRun,
    selectedValidTimeMs: target.selectedValidTimeMs,
    lowerHourToken: target.lowerHourToken,
    upperHourToken: target.upperHourToken,
    mix: target.mix,
    field,
    precipTypeOverlay,
    pressureContours,
    particles,
  }
}

describe('loadForecastData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaders.field.mockImplementation(async (hourToken: string) => ({
      layerId: 'relative_humidity',
      hourToken,
    }))
    loaders.precipTypeOverlay.mockImplementation(async (hourToken: string) => ({
      artifactId: 'precip_type_surface',
      hourToken,
    }))
    loaders.pressureContours.mockImplementation(async (hourToken: string) => ({
      artifactId: 'prmsl_msl',
      hourToken,
    }))
    loaders.particles.mockImplementation(async (hourToken: string) => ({
      artifactId: 'wind10m_uv',
      hourToken,
    }))
  })

  it('loads field and particle interpolation windows from a forecast data plan', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface'],
      vectorArtifactIds: ['wind10m_uv'],
    })
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const particleLayer = getAvailableParticleLayers(createActiveRunFixture(manifest)).wind!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: particleLayer,
    })
    const plan = createPlan(target, { includeOverlay: true })

    await expect(loadForecastData({
      plan,
    })).resolves.toEqual({
      field: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
      precipTypeOverlay: {
        lower: { artifactId: 'precip_type_surface', hourToken: '000' },
        upper: { artifactId: 'precip_type_surface', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
      pressureContours: null,
      particles: {
        lower: { artifactId: 'wind10m_uv', hourToken: '000' },
        upper: { artifactId: 'wind10m_uv', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.precipTypeOverlay).toHaveBeenCalledTimes(2)
    expect(loaders.pressureContours).not.toHaveBeenCalled()
    expect(loaders.particles).toHaveBeenCalledTimes(2)
  })

  it('loads only the selected layer when no particle channel is planned', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface'],
      vectorArtifactIds: [],
    })
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: null,
    })
    const plan = createPlan(target, { includeParticles: false })

    await expect(loadForecastData({
      plan,
    })).resolves.toEqual({
      field: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
      precipTypeOverlay: null,
      pressureContours: null,
      particles: null,
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.precipTypeOverlay).not.toHaveBeenCalled()
    expect(loaders.pressureContours).not.toHaveBeenCalled()
    expect(loaders.particles).not.toHaveBeenCalled()
  })

  it('loads optional pressure contour interpolation windows when planned', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface', 'prmsl_msl'],
      vectorArtifactIds: [],
    })
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: null,
    })
    const plan = createPlan(target, { includeContours: true, includeParticles: false })

    await expect(loadForecastData({ plan })).resolves.toMatchObject({
      pressureContours: {
        lower: { artifactId: 'prmsl_msl', hourToken: '000' },
        upper: { artifactId: 'prmsl_msl', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
    })

    expect(loaders.pressureContours).toHaveBeenCalledTimes(2)
  })

  it('falls back to plain field data when an optional overlay load fails', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['prate_surface'],
      vectorArtifactIds: [],
    })
    const selectedLayer = FORECAST_LAYERS_BY_ID.precipitation_rate!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: null,
    })
    const plan = createPlan(target, { includeOverlay: true, includeParticles: false })
    loaders.precipTypeOverlay.mockRejectedValue(new Error('overlay missing'))

    await expect(loadForecastData({ plan })).resolves.toMatchObject({
      field: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
      },
      precipTypeOverlay: null,
      pressureContours: null,
      particles: null,
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.precipTypeOverlay).toHaveBeenCalledTimes(2)
  })

  it('falls back to plain field data when pressure contour loading fails', async () => {
    const manifest = createManifestFixture({
      scalarArtifactIds: ['rh_surface', 'prmsl_msl'],
      vectorArtifactIds: [],
    })
    const selectedLayer = FORECAST_LAYERS_BY_ID.relative_humidity!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: null,
    })
    const plan = createPlan(target, { includeContours: true, includeParticles: false })
    loaders.pressureContours.mockRejectedValue(new Error('pressure missing'))

    await expect(loadForecastData({ plan })).resolves.toMatchObject({
      field: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
      },
      precipTypeOverlay: null,
      pressureContours: null,
      particles: null,
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.pressureContours).toHaveBeenCalledTimes(2)
  })
})

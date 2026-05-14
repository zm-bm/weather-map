import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createManifestFixture,
} from '../test/fixtures'
import {
  getAvailableParticleLayers,
  getAvailableLayers,
  type LayerSpec,
  type ParticleLayerSpec,
} from '../forecast-catalog'
import { createForecastFrameTarget, type ForecastFrameTarget } from './target'
import type { ForecastFramePlan } from './plan'
import { loadForecastFrames } from './load'

const loaders = {
  field: vi.fn(),
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
}): ForecastFrameTarget {
  const selectedLayer = args.selectedLayer ?? getAvailableLayers(args.manifest).tmp_surface!
  const selectedParticleLayer = args.selectedParticleLayer === undefined
    ? (getAvailableParticleLayers(args.manifest).wind_particles ?? null)
    : args.selectedParticleLayer

  return createForecastFrameTarget({
    manifest: args.manifest,
    selectedLayerId: selectedLayer.id,
    selectedLayer,
    selectedParticleLayerId: selectedParticleLayer?.id ?? null,
    selectedParticleLayer,
    frameWindow: {
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

function createPlan(target: ForecastFrameTarget, args: {
  includeParticles?: boolean
} = {}): ForecastFramePlan {
  const field = {
    key: 'field:key',
    load: loaders.field,
  }
  const particles = args.includeParticles === false
    ? null
    : {
      key: 'particles:key',
      load: loaders.particles,
    }

  return {
    manifest: target.manifest,
    selectedValidTimeMs: target.selectedValidTimeMs,
    lowerHourToken: target.lowerHourToken,
    upperHourToken: target.upperHourToken,
    mix: target.mix,
    field,
    particles,
  }
}

describe('loadForecastFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaders.field.mockImplementation(async (hourToken: string) => ({
      layerId: 'rh_surface',
      hourToken,
    }))
    loaders.particles.mockImplementation(async (hourToken: string) => ({
      artifactId: 'wind10m_uv',
      hourToken,
    }))
  })

  it('loads field and particle frame windows from a forecast frame plan', async () => {
    const manifest = createManifestFixture({
      scalarProducts: ['rh_surface'],
      vectorProducts: ['wind10m_uv'],
    })
    const selectedLayer = getAvailableLayers(manifest).rh_surface!
    const particleLayer = getAvailableParticleLayers(manifest).wind_particles!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: particleLayer,
    })
    const plan = createPlan(target)

    await expect(loadForecastFrames({
      plan,
    })).resolves.toEqual({
      field: {
        lower: { layerId: 'rh_surface', hourToken: '000' },
        upper: { layerId: 'rh_surface', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
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
    expect(loaders.particles).toHaveBeenCalledTimes(2)
  })

  it('loads only the selected layer when no particle channel is planned', async () => {
    const manifest = createManifestFixture({
      scalarProducts: ['rh_surface'],
      vectorProducts: [],
    })
    const selectedLayer = getAvailableLayers(manifest).rh_surface!
    const target = createTarget({
      manifest,
      selectedLayer,
      selectedParticleLayer: null,
    })
    const plan = createPlan(target, { includeParticles: false })

    await expect(loadForecastFrames({
      plan,
    })).resolves.toEqual({
      field: {
        lower: { layerId: 'rh_surface', hourToken: '000' },
        upper: { layerId: 'rh_surface', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
      particles: null,
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.particles).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from 'vitest'

import { createArtifactLoader } from '../forecast-artifacts'
import {
  getAvailableLayers,
  getAvailableParticleLayers,
} from '../forecast-catalog'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createSignalFixture,
} from '../test/fixtures'
import { createForecastDataTarget } from './target'
import { createForecastDataPlan } from './plan'

function dataPlan(args: {
  manifest: ReturnType<typeof createFrameManifestFixture>
  layerId?: string
  includeParticles?: boolean
}) {
  const selectedLayer = getAvailableLayers(args.manifest)[args.layerId ?? 'temperature']!
  const selectedParticleLayer = args.includeParticles === false
    ? null
    : getAvailableParticleLayers(args.manifest).wind!
  const target = createForecastDataTarget({
    manifest: args.manifest,
    selectedLayerId: selectedLayer.id,
    selectedLayer,
    selectedParticleLayerId: selectedParticleLayer?.id ?? null,
    selectedParticleLayer,
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
      lowerHourToken: '000',
      upperHourToken: '000',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
      mix: 0,
    },
    retryToken: 0,
  })

  return createForecastDataPlan({
    target,
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      manifest: args.manifest,
      signal: createSignalFixture(),
    }),
  })
}

describe('createForecastDataPlan', () => {
  it('builds selected field and particle channels', () => {
    const plan = dataPlan({
      manifest: createFrameManifestFixture({
        cycle: '2026040900',
        forecastHours: ['003', '006'],
      }),
      layerId: 'wind_speed',
    })

    expect(plan.field.key).toBe('2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(plan.particles?.key).toBe('2026040900:rev:wind:wind10m_uv')
    expect(plan.lowerHourToken).toBe('000')
    expect(plan.upperHourToken).toBe('000')
  })

  it('omits the particle channel when no particle layer is selected', () => {
    const plan = dataPlan({
      manifest: createFrameManifestFixture({
        cycle: '2026040900',
        vectorArtifactIds: [],
      }),
      includeParticles: false,
    })

    expect(plan.field.key).toBe('2026040900:rev:temperature:artifact:tmp_surface')
    expect(plan.particles).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import {
  createActiveRunFixture,
  createLayerDatasetAvailabilityFixture,
  createManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '@/test/fixtures'
import {
  DEFAULT_FORECAST_SYNC_OPTIONS,
  resolveForecastSyncPlan,
} from './index'

const syncOptions = DEFAULT_FORECAST_SYNC_OPTIONS

describe('resolveForecastSyncPlan', () => {
  it('returns null for unloaded or unrenderable selection state', () => {
    expect(resolveForecastSyncPlan({
      activeRun: null,
      selectedLayerId: 'temperature',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })).toBeNull()

    const unavailableActiveRun = createActiveRunFixture(createManifestFixture({
      layers: {
        temperature: { datasets: {
          gfs: createLayerDatasetAvailabilityFixture({
            state: 'temporarily_unavailable',
            required_artifacts: ['tmp_surface'],
          }),
        } },
      },
    }))

    expect(resolveForecastSyncPlan({
      activeRun: unavailableActiveRun,
      selectedLayerId: 'temperature',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })).toBeNull()

    const nonRenderableActiveRun = createActiveRunFixture(createManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture({
          id: 'wind10m_uv',
          components: ['speed'],
        }),
      },
    }))

    expect(resolveForecastSyncPlan({
      activeRun: nonRenderableActiveRun,
      selectedLayerId: 'wind_speed',
      selectedParticleLayerId: null,
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })).toBeNull()
  })

  it('resolves raster and particle window plans', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000', '003', '006'],
    })
    const activeRun = createActiveRunFixture(manifest)

    const plan = resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'wind_speed',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
      syncOptions,
    })

    expect(plan).toEqual(expect.objectContaining({
      frameIds: ['000', '003', '006'],
      lowerFrameId: '003',
      upperFrameId: '006',
      mix: 1 / 6,
      minuteOffset: 30,
    }))
    expect(plan?.windowPlans).toEqual([
      expect.objectContaining({
        id: 'raster',
        key: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:raster:wind_speed:wind10m_uv:u+v',
        failurePolicy: 'required',
        output: 'single',
        frames: [expect.objectContaining({
          sourceKind: 'raster',
          artifactId: 'wind10m_uv',
          bandIds: ['u', 'v'],
          source: expect.objectContaining({
            layerId: 'wind_speed',
            artifactId: 'wind10m_uv',
            bands: [
              { id: 'u' },
              { id: 'v' },
            ],
            overlays: [],
          }),
        })],
      }),
      expect.objectContaining({
        id: 'particles',
        key: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:particles:wind:wind10m_uv:u+v',
        failurePolicy: 'required',
        output: 'single',
        frames: [expect.objectContaining({
          sourceKind: 'particles',
          artifactId: 'wind10m_uv',
          bandIds: ['u', 'v'],
          source: {
            id: 'wind',
            source: {
              artifactId: 'wind10m_uv',
              bands: [{ id: 'u' }, { id: 'v' }],
            },
          },
        })],
      }),
    ])
    expect(plan?.windowPlanKeys).toEqual({
      raster: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:raster:wind_speed:wind10m_uv:u+v',
      particles: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:particles:wind:wind10m_uv:u+v',
    })
    expect(plan?.windowPlanSetKey).toBe(
      'gfs:2026040900:20260413T120000Z-abcdef12:rev:raster:wind_speed:wind10m_uv:u+v|' +
      'gfs:2026040900:20260413T120000Z-abcdef12:rev:particles:wind:wind10m_uv:u+v'
    )
  })

  it('resolves cloud raster and precipitation overlay window plans', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000'],
      artifacts: {
        tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        prate_surface: createScalarArtifactFixture({ id: 'prate_surface' }),
        wind10m_uv: createVectorArtifactFixture({ id: 'wind10m_uv' }),
        cloud_layers: createVectorArtifactFixture({
          id: 'cloud_layers',
          components: ['low', 'middle', 'high'],
        }),
        precip_type_surface: createVectorArtifactFixture({
          id: 'precip_type_surface',
          components: ['snow_frac', 'mix_frac'],
        }),
      },
    })
    const activeRun = createActiveRunFixture(manifest)

    const cloudPlan = resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'cloud_layers',
      selectedParticleLayerId: null,
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })
    const precipPlan = resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'precipitation_rate',
      selectedParticleLayerId: null,
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })

    expect(cloudPlan?.windowPlans).toEqual([
      expect.objectContaining({
        id: 'raster',
        key: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:raster:cloud_layers:cloud_layers:low+middle+high',
        output: 'single',
        frames: [expect.objectContaining({
          sourceKind: 'raster',
          artifactId: 'cloud_layers',
          bandIds: ['low', 'middle', 'high'],
          source: expect.objectContaining({
            layerId: 'cloud_layers',
            artifactId: 'cloud_layers',
            bands: [
              { id: 'low' },
              { id: 'middle' },
              { id: 'high' },
            ],
            overlays: [],
          }),
        })],
      }),
    ])
    expect(precipPlan?.windowPlans.find((spec) => spec.id === 'overlay')).toEqual(
      expect.objectContaining({
        id: 'overlay',
        key: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:overlay:gfs:2026040900:20260413T120000Z-abcdef12:rev:overlay:precipitation_type:precip_type_surface:snow_frac+mix_frac',
        output: 'array',
        frames: [
          expect.objectContaining({
            sourceKind: 'overlay',
            source: {
              id: 'precipitation_type',
              style: 'precipitation-type-pattern',
              source: {
                artifactId: 'precip_type_surface',
                bands: [{ id: 'snow_frac' }, { id: 'mix_frac' }],
              },
              optional: true,
            },
            bandIds: ['snow_frac', 'mix_frac'],
            order: 'by-name',
            failurePolicy: 'optional',
          }),
        ],
      })
    )
  })

  it('resolves pressure contour window plans from the catalog when the artifact is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000'],
      scalarArtifactIds: ['tmp_surface', 'prmsl_msl'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)

    const plan = resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'temperature',
      selectedParticleLayerId: null,
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })

    expect(plan?.windowPlans.find((spec) => spec.id === 'contour')).toEqual(
      expect.objectContaining({
        key: 'gfs:2026040900:20260413T120000Z-abcdef12:rev:contour:pressure_contours:prmsl_msl:value',
        failurePolicy: 'optional',
        output: 'single',
        frames: [expect.objectContaining({
          sourceKind: 'contour',
          artifactId: 'prmsl_msl',
          bandIds: ['value'],
          source: {
            id: 'pressure_contours',
            source: {
              artifactId: 'prmsl_msl',
              bands: [{ id: 'value' }],
            },
          },
        })],
      })
    )
  })

  it('omits contour and particles when sync options disable them', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000'],
      scalarArtifactIds: ['tmp_surface', 'prmsl_msl'],
      vectorArtifactIds: ['wind10m_uv'],
    })
    const activeRun = createActiveRunFixture(manifest)

    const plan = resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'temperature',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions: { contour: false, particles: false },
    })

    expect(plan?.windowPlans.map((spec) => spec.id)).toEqual(['raster'])
  })

  it('does not resolve optional contour or particle catalog entries when they are disabled', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000'],
      artifacts: {
        tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        prmsl_msl: createVectorArtifactFixture({ id: 'prmsl_msl' }),
        wind10m_uv: createScalarArtifactFixture({ id: 'wind10m_uv' }),
      },
    })
    const activeRun = createActiveRunFixture(manifest)

    expect(() => resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'temperature',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions: { contour: false, particles: false },
    })).not.toThrow()

    expect(resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'temperature',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions: { contour: false, particles: false },
    })?.windowPlans.map((spec) => spec.id)).toEqual(['raster'])
  })

  it('returns null when the selected layer is absent from the catalog map', () => {
    const manifest = createManifestFixture()
    const activeRun = createActiveRunFixture(manifest)

    expect(resolveForecastSyncPlan({
      activeRun,
      selectedLayerId: 'missing_layer',
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
      syncOptions,
    })).toBeNull()
  })
})

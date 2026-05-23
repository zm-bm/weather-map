import { describe, expect, it } from 'vitest'

import { createArtifactLoader } from '../forecast-artifacts'
import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
} from '../forecast-catalog'
import {
  createLayerDataSource,
  createForecastDataTarget,
  createWindVectorDataSource,
} from '../forecast-data-targets'
import type { ForecastDataKind } from '../forecast-data-loaders'
import {
  createActiveRunFixture,
  createConfigFixture,
  createScalarArtifactFixture,
  createSingleTimeManifestFixture,
  createVectorArtifactFixture,
  createSignalFixture,
} from '../test/fixtures'
import { createForecastDataRequest } from './request'

function dataRequest(args: {
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
  layerId?: string
  includeWindVectors?: boolean
  dataOptions?: Parameters<typeof createForecastDataRequest>[0]['options']
}) {
  const activeRun = createActiveRunFixture(args.manifest)
  const selectedLayer = FORECAST_LAYERS_BY_ID[args.layerId ?? 'temperature']!
  const windLayer = args.includeWindVectors === false
    ? null
    : getAvailableParticleLayers(activeRun).wind!
  const target = createForecastDataTarget({
    activeRun,
    layerDataSource: createLayerDataSource(selectedLayer),
    windVectorDataSource: windLayer == null
      ? null
      : createWindVectorDataSource(windLayer),
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
      lowerHourToken: '000',
      upperHourToken: '000',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
      mix: 0,
    },
  })

  return createForecastDataRequest({
    target,
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      activeRun,
      signal: createSignalFixture(),
    }),
    retryToken: 0,
    options: args.dataOptions,
  })
}

function dataKinds(request: ReturnType<typeof dataRequest>): ForecastDataKind[] {
  return request.loads.map((load) => load.id)
}

describe('createForecastDataRequest', () => {
  it('builds selected field and wind-vector data', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        forecastHours: ['003', '006'],
      }),
      layerId: 'wind_speed',
    })

    expect(dataKinds(request)).toEqual(['field', 'windVectors'])
    expect(request.loads.find((load) => load.id === 'field')?.key)
      .toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(request.loads.find((load) => load.id === 'windVectors')?.key)
      .toBe('gfs:2026040900:rev:wind-vectors:wind:wind10m_uv')
    expect(request.requestKey).toContain(':000:000:0:0')
  })

  it('omits wind vectors when no wind source is selected', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        vectorArtifactIds: [],
      }),
      includeWindVectors: false,
    })

    expect(dataKinds(request)).toEqual(['field'])
  })

  it('builds an optional precipitation type data when the optional artifact exists', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          prate_surface: createScalarArtifactFixture({ id: 'prate_surface' }),
          precip_type_surface: createVectorArtifactFixture({
            id: 'precip_type_surface',
            components: ['snow_frac', 'mix_frac'],
          }),
        },
      }),
      layerId: 'precipitation_rate',
      includeWindVectors: false,
    })

    expect(dataKinds(request)).toEqual(['field', 'precipType'])
    expect(request.loads.find((load) => load.id === 'precipType')?.failurePolicy)
      .toBe('optional')
  })

  it('builds cloud layers instead of a scalar field for cloud layer data', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          cloud_layers: createVectorArtifactFixture({
            id: 'cloud_layers',
            units: '%',
            components: ['low', 'middle', 'high'],
          }),
        },
      }),
      layerId: 'cloud_layers',
      includeWindVectors: false,
    })

    expect(dataKinds(request)).toEqual(['cloudLayers'])
    expect(request.loads[0]?.key).toBe('gfs:2026040900:rev:cloud_layers:cloud-layers:cloud_layers')
  })

  it('builds an optional pressure data when mean sea-level pressure exists', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
          prmsl_msl: createScalarArtifactFixture({
            id: 'prmsl_msl',
            units: 'Pa',
            parameter: 'prmsl',
            level: 'mean sea level',
          }),
        },
      }),
      includeWindVectors: false,
    })

    expect(dataKinds(request)).toEqual(['field', 'pressure'])
    expect(request.loads.find((load) => load.id === 'pressure')?.failurePolicy)
      .toBe('optional')
  })

  it('omits pressure when missing or disabled', () => {
    const missingPressure = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        },
      }),
      includeWindVectors: false,
    })
    const disabledPressure = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
          prmsl_msl: createScalarArtifactFixture({ id: 'prmsl_msl' }),
        },
      }),
      includeWindVectors: false,
      dataOptions: { pressure: false },
    })

    expect(dataKinds(missingPressure)).toEqual(['field'])
    expect(dataKinds(disabledPressure)).toEqual(['field'])
  })

  it('omits precipitation type when a layer has no valid precip-type artifact', () => {
    const noOverlay = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
          precip_type_surface: createVectorArtifactFixture({
            id: 'precip_type_surface',
            components: ['snow_frac', 'mix_frac'],
          }),
        },
      }),
      includeWindVectors: false,
    })
    const invalidComponents = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          prate_surface: createScalarArtifactFixture({ id: 'prate_surface' }),
          precip_type_surface: createVectorArtifactFixture({
            id: 'precip_type_surface',
            components: ['u', 'v'],
          }),
        },
      }),
      layerId: 'precipitation_rate',
      includeWindVectors: false,
    })

    expect(dataKinds(noOverlay)).toEqual(['field'])
    expect(dataKinds(invalidComponents)).toEqual(['field'])
  })
})

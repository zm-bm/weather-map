import { describe, expect, it } from 'vitest'

import {
  createActiveRunFixture,
  createCloudLayerSourceFixture,
  createConfigFixture,
  createFieldLayerSourceFixture,
  createForecastDataTargetFixture,
  createPrecipTypeSourceFixture,
  createScalarArtifactFixture,
  createSingleTimeManifestFixture,
  createVectorArtifactFixture,
} from '@/test/fixtures'
import type { ForecastDataTarget } from './target'
import type { ForecastDataKind } from './slices'
import { createForecastDataRequest } from './request'

function dataRequest(args: {
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
  layerSource?: ForecastDataTarget['layerSource']
  includeWindVectors?: boolean
  dataOptions?: Parameters<typeof createForecastDataRequest>[0]['options']
  retryToken?: number
  lowerHourToken?: string
  upperHourToken?: string
  minuteOffset?: number
}) {
  const activeRun = createActiveRunFixture(args.manifest)
  const target = createForecastDataTargetFixture({
    activeRun,
    layerSource: args.layerSource,
    windVectorSource: args.includeWindVectors === false ? null : undefined,
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12, args.minuteOffset ?? 0),
      lowerHourToken: args.lowerHourToken ?? '000',
      upperHourToken: args.upperHourToken ?? '000',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
      mix: 0,
    },
  })

  return createForecastDataRequest({
    target,
    config: createConfigFixture(),
    signal: new AbortController().signal,
    retryToken: args.retryToken ?? 0,
    options: args.dataOptions,
  })
}

function dataKinds(request: ReturnType<typeof dataRequest>): ForecastDataKind[] {
  return request.loads.map((load) => load.id)
}

function windSpeedSource(): ForecastDataTarget['layerSource'] {
  return createFieldLayerSourceFixture({
    layerId: 'wind_speed',
    paletteId: 'wind.gust.mps.v1',
    displayRange: [0, 55],
    fieldSource: {
      kind: 'derived',
      artifactId: 'wind10m_uv',
      recipe: 'wind-speed',
    },
  })
}

function precipitationRateSource(): ForecastDataTarget['layerSource'] {
  return createFieldLayerSourceFixture({
    layerId: 'precipitation_rate',
    paletteId: 'precip.rate.mm_hr.v1',
    displayRange: [0, 50],
    fieldSource: {
      kind: 'scalar',
      artifactId: 'prate_surface',
    },
    precipType: createPrecipTypeSourceFixture(),
  })
}

describe('createForecastDataRequest', () => {
  it('builds selected field and wind-vector data', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        forecastHours: ['003', '006'],
      }),
      layerSource: windSpeedSource(),
    })

    expect(dataKinds(request)).toEqual(['field', 'windVectors'])
    expect(request.loads.find((load) => load.id === 'field')?.key)
      .toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(request.loads.find((load) => load.id === 'windVectors')?.key)
      .toBe('gfs:2026040900:rev:wind-vectors:wind:wind10m_uv')
    expect(request.requestKey).toContain(':000:000:0:0')
  })

  it('builds scoped request keys from data keys and interpolation state', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        forecastHours: ['003', '006'],
      }),
      lowerHourToken: '3',
      upperHourToken: '6',
      minuteOffset: 30,
      retryToken: 2,
      layerSource: windSpeedSource(),
    })

    expect(request.requestKey).toBe(
      'gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv|' +
      'gfs:2026040900:rev:wind-vectors:wind:wind10m_uv:003:006:30:2'
    )
  })

  it('uses an explicit empty-data key when no loads are planned', () => {
    const request = dataRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        scalarArtifactIds: ['other_surface'],
        vectorArtifactIds: [],
      }),
      includeWindVectors: false,
    })

    expect(dataKinds(request)).toEqual([])
    expect(request.requestKey).toBe('gfs:2026040900:rev:data:none:000:000:0:0')
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
      layerSource: precipitationRateSource(),
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
      layerSource: createCloudLayerSourceFixture(),
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
      layerSource: precipitationRateSource(),
      includeWindVectors: false,
    })

    expect(dataKinds(noOverlay)).toEqual(['field'])
    expect(dataKinds(invalidComponents)).toEqual(['field'])
  })
})

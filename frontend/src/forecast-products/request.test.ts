import { describe, expect, it } from 'vitest'

import { createArtifactLoader } from '../forecast-artifacts'
import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import {
  createActiveRunFixture,
  createConfigFixture,
  createScalarArtifactFixture,
  createSingleTimeManifestFixture,
  createVectorArtifactFixture,
  createSignalFixture,
} from '../test/fixtures'
import { createForecastProductTarget } from './target'
import { createForecastProductRequest } from './request'
import type { ForecastProductId } from './types'

function productRequest(args: {
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
  layerId?: string
  includeWindVectors?: boolean
  productOptions?: Parameters<typeof createForecastProductRequest>[0]['options']
}) {
  const activeRun = createActiveRunFixture(args.manifest)
  const selectedLayer = FORECAST_LAYERS_BY_ID[args.layerId ?? 'temperature']!
  const windLayer = args.includeWindVectors === false
    ? null
    : getAvailableParticleLayers(activeRun).wind!
  const target = createForecastProductTarget({
    activeRun,
    selectedLayer,
    windVectorSource: windLayer == null
      ? null
      : {
        id: String(windLayer.id),
        artifactId: particleLayerSourceArtifactId(windLayer),
      },
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
      lowerHourToken: '000',
      upperHourToken: '000',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
      mix: 0,
    },
  })

  return createForecastProductRequest({
    target,
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      activeRun,
      signal: createSignalFixture(),
    }),
    retryToken: 0,
    options: args.productOptions,
  })
}

function productIds(request: ReturnType<typeof productRequest>): ForecastProductId[] {
  return request.products.map((product) => product.id)
}

describe('createForecastProductRequest', () => {
  it('builds selected field and wind-vector products', () => {
    const request = productRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        forecastHours: ['003', '006'],
      }),
      layerId: 'wind_speed',
    })

    expect(productIds(request)).toEqual(['field', 'windVectors'])
    expect(request.products.find((product) => product.id === 'field')?.key)
      .toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(request.products.find((product) => product.id === 'windVectors')?.key)
      .toBe('gfs:2026040900:rev:wind-vectors:wind:wind10m_uv')
    expect(request.requestKey).toContain(':000:000:0:0')
  })

  it('omits wind vectors when no wind source is selected', () => {
    const request = productRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        vectorArtifactIds: [],
      }),
      includeWindVectors: false,
    })

    expect(productIds(request)).toEqual(['field'])
  })

  it('builds an optional precipitation type product when the optional artifact exists', () => {
    const request = productRequest({
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

    expect(productIds(request)).toEqual(['field', 'precipType'])
    expect(request.products.find((product) => product.id === 'precipType')?.failurePolicy)
      .toBe('optional')
  })

  it('builds cloud layers instead of a scalar field for cloud layer products', () => {
    const request = productRequest({
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

    expect(productIds(request)).toEqual(['cloudLayers'])
    expect(request.products[0]?.key).toBe('gfs:2026040900:rev:cloud_layers:cloud-layers:cloud_layers')
  })

  it('builds an optional pressure product when mean sea-level pressure exists', () => {
    const request = productRequest({
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

    expect(productIds(request)).toEqual(['field', 'pressure'])
    expect(request.products.find((product) => product.id === 'pressure')?.failurePolicy)
      .toBe('optional')
  })

  it('omits pressure when missing or disabled', () => {
    const missingPressure = productRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        },
      }),
      includeWindVectors: false,
    })
    const disabledPressure = productRequest({
      manifest: createSingleTimeManifestFixture({
        cycle: '2026040900',
        artifacts: {
          tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
          prmsl_msl: createScalarArtifactFixture({ id: 'prmsl_msl' }),
        },
      }),
      includeWindVectors: false,
      productOptions: { pressure: false },
    })

    expect(productIds(missingPressure)).toEqual(['field'])
    expect(productIds(disabledPressure)).toEqual(['field'])
  })

  it('omits precipitation type when a layer has no valid precip-type artifact', () => {
    const noOverlay = productRequest({
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
    const invalidComponents = productRequest({
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

    expect(productIds(noOverlay)).toEqual(['field'])
    expect(productIds(invalidComponents)).toEqual(['field'])
  })
})

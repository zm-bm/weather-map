import type {
  LatestForecastRun,
  Manifest,
} from '../../forecast-manifest'
import {
  FORECAST_MANIFEST_SCHEMA,
  FORECAST_MANIFEST_SCHEMA_VERSION,
  FORECAST_PAYLOAD_CONTRACT,
  activeForecastRunForModel,
} from '../../forecast-manifest'
import {
  createSingleTimeManifestFixture,
  createLayerModelAvailabilityFixture,
  createLatestRunFixture,
  createManifestLayerFixture,
} from './manifest'

export function createMultiModelManifestFixture(options: {
  gfsManifest?: Manifest | LatestForecastRun | null
  iconManifest?: Manifest | LatestForecastRun | null
  layers?: Manifest['layers']
} = {}): Manifest {
  const gfsLatest = options.gfsManifest === undefined
    ? createLatestRunFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      })
    : latestFromFixture(options.gfsManifest, 'gfs')
  const iconLatest = options.iconManifest === undefined
    ? createLatestRunFixture({
        model: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      })
    : latestFromFixture(options.iconManifest, 'icon')

  return {
    schema: FORECAST_MANIFEST_SCHEMA,
    schemaVersion: FORECAST_MANIFEST_SCHEMA_VERSION,
    generatedAt: '2026-05-16T00:00:00Z',
    catalogVersion: 'forecast-catalog-v1',
    payloadContract: FORECAST_PAYLOAD_CONTRACT,
    models: {
      gfs: {
        label: 'GFS',
        latest: gfsLatest,
      },
      icon: {
        label: 'ICON',
        latest: iconLatest,
      },
    },
    layers: options.layers ?? {},
  }
}

export function createCatalogManifestFixture(
  layers: Manifest['layers'] = {}
): Manifest {
  const available = (requiredArtifacts: string[]) => createLayerModelAvailabilityFixture({ requiredArtifacts })
  const unsupported = (requiredArtifacts: string[]) => createLayerModelAvailabilityFixture({
    state: 'unsupported',
    support: 'unavailable',
    requiredArtifacts,
  })

  return createMultiModelManifestFixture({
    layers: {
      temperature: createManifestLayerFixture({
        gfs: available(['tmp_surface']),
        icon: available(['tmp_surface']),
      }),
      relative_humidity: createManifestLayerFixture({
        gfs: available(['rh_surface']),
        icon: available(['rh_surface']),
      }),
      wind_gust: createManifestLayerFixture({
        gfs: available(['gust_surface']),
        icon: available(['gust_surface']),
      }),
      precipitation_rate: createManifestLayerFixture({
        gfs: available(['prate_surface']),
        icon: available(['prate_surface']),
      }),
      cloud_layers: createManifestLayerFixture({
        gfs: available(['cloud_layers']),
        icon: available(['cloud_layers']),
      }),
      accumulated_precipitation: createManifestLayerFixture({
        gfs: unsupported(['precip_total_surface']),
        icon: available(['precip_total_surface']),
      }),
      visibility: createManifestLayerFixture({
        gfs: available(['visibility_surface']),
        icon: unsupported(['visibility_surface']),
      }),
      ...layers,
    },
  })
}

function latestFromFixture(
  fixture: Manifest | LatestForecastRun | null,
  modelId: string
): LatestForecastRun | null {
  if (fixture == null) return null
  if ('run' in fixture) return fixture
  return activeForecastRunForModel(fixture, modelId)?.latest ?? null
}

export function createGfsIconManifestFixture(): Manifest {
  return createMultiModelManifestFixture({
    gfsManifest: createSingleTimeManifestFixture({
      model: { id: 'gfs', label: 'GFS' },
      cycle: '2026040900',
    }),
    iconManifest: createSingleTimeManifestFixture({
      model: { id: 'icon', label: 'ICON' },
      cycle: '2026040912',
    }),
  })
}

import type {
  LatestForecastRun,
  Manifest,
} from '@/forecast/manifest'
import {
  MANIFEST_INDEX_SCHEMA,
  MANIFEST_INDEX_SCHEMA_VERSION,
  DATA_PAYLOAD_CONTRACT,
  activeForecastRunForDataset,
} from '@/forecast/manifest'
import {
  createLayerDatasetAvailabilityFixture,
  createLatestRunFixture,
  createManifestLayerFixture,
} from './manifest'

export function createMultiDatasetManifestFixture(options: {
  gfsManifest?: Manifest | LatestForecastRun | null
  iconManifest?: Manifest | LatestForecastRun | null
  layers?: Manifest['layers']
} = {}): Manifest {
  const gfsLatest = options.gfsManifest === undefined
    ? createLatestRunFixture({
        dataset: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      })
    : latestFromFixture(options.gfsManifest, 'gfs')
  const iconLatest = options.iconManifest === undefined
    ? createLatestRunFixture({
        dataset: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      })
    : latestFromFixture(options.iconManifest, 'icon')

  return {
    schema: MANIFEST_INDEX_SCHEMA,
    schema_version: MANIFEST_INDEX_SCHEMA_VERSION,
    generated_at: '2026-05-16T00:00:00Z',
    catalog_version: 'forecast-catalog-v1',
    payload_contract: DATA_PAYLOAD_CONTRACT,
    datasets: {
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
  const available = (required_artifacts: string[]) => createLayerDatasetAvailabilityFixture({ required_artifacts })
  const unsupported = (required_artifacts: string[]) => createLayerDatasetAvailabilityFixture({
    state: 'unsupported',
    support: 'unavailable',
    required_artifacts,
  })

  return createMultiDatasetManifestFixture({
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
        gfs: available(['precip_total_surface']),
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
  datasetId: string
): LatestForecastRun | null {
  if (fixture == null) return null
  if ('run' in fixture) return fixture
  return activeForecastRunForDataset(fixture, datasetId)?.latest ?? null
}

import type {
  AvailabilityLatestManifest,
  AvailabilityManifestArtifactSpec,
  LayerModelAvailability,
  ModelLayerAvailabilityIndex,
} from '../../forecast-availability'
import type { CycleManifest, ManifestArtifactSpec } from '../../manifest'
import { createFrameManifestFixture } from './manifest'

export function createAvailabilityLatestFixture(
  manifest: CycleManifest = createFrameManifestFixture()
): AvailabilityLatestManifest {
  return {
    schema: manifest.schema,
    schemaVersion: manifest.schemaVersion,
    payloadContract: manifest.payloadContract,
    run: manifest.run,
    times: manifest.times,
    artifacts: Object.fromEntries(
      Object.entries(manifest.artifacts).map(([artifactId, artifact]) => [
        artifactId,
        createAvailabilityArtifactFixture(artifact),
      ])
    ),
  }
}

export function createAvailabilityIndexFixture(options: {
  gfsManifest?: CycleManifest | null
  iconManifest?: CycleManifest | null
  layers?: ModelLayerAvailabilityIndex['layers']
} = {}): ModelLayerAvailabilityIndex {
  const gfsManifest = options.gfsManifest === undefined
    ? createFrameManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      })
    : options.gfsManifest
  const iconManifest = options.iconManifest === undefined
    ? createFrameManifestFixture({
        model: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      })
    : options.iconManifest

  return {
    schema: 'weather-map-model-layer-availability-index',
    schemaVersion: 2,
    generatedAt: '2026-05-16T00:00:00Z',
    catalogVersion: 'forecast-catalog-v1',
    models: {
      gfs: availabilityModel('GFS', gfsManifest),
      icon: availabilityModel('ICON', iconManifest),
    },
    layers: options.layers ?? {},
  }
}

export function createCatalogAvailabilityIndexFixture(
  layers: ModelLayerAvailabilityIndex['layers'] = {}
): ModelLayerAvailabilityIndex {
  const available = (requiredArtifacts: string[]) => createLayerModelAvailabilityFixture({ requiredArtifacts })
  const unsupported = (requiredArtifacts: string[]) => createLayerModelAvailabilityFixture({
    state: 'unsupported',
    support: 'unavailable',
    requiredArtifacts,
  })

  return createAvailabilityIndexFixture({
    gfsManifest: null,
    iconManifest: null,
    layers: {
      temperature: createAvailabilityLayerFixture({
        gfs: available(['tmp_surface']),
        icon: available(['tmp_surface']),
      }),
      relative_humidity: createAvailabilityLayerFixture({
        gfs: available(['rh_surface']),
        icon: available(['rh_surface']),
      }),
      wind_gust: createAvailabilityLayerFixture({
        gfs: available(['gust_surface']),
        icon: available(['gust_surface']),
      }),
      precipitation_rate: createAvailabilityLayerFixture({
        gfs: available(['prate_surface']),
        icon: available(['prate_surface']),
      }),
      accumulated_precipitation: createAvailabilityLayerFixture({
        gfs: unsupported(['precip_total_surface']),
        icon: available(['precip_total_surface']),
      }),
      visibility: createAvailabilityLayerFixture({
        gfs: available(['visibility_surface']),
        icon: unsupported(['visibility_surface']),
      }),
      ...layers,
    },
  })
}

export function createLayerModelAvailabilityFixture(
  overrides: Partial<LayerModelAvailability> = {}
): LayerModelAvailability {
  return {
    state: 'available',
    support: 'native',
    requiredArtifacts: [],
    optionalArtifacts: [],
    ...overrides,
  }
}

export function createAvailabilityLayerFixture(
  models: Record<string, LayerModelAvailability>
): ModelLayerAvailabilityIndex['layers'][string] {
  return { models }
}

function availabilityModel(
  label: string,
  manifest: CycleManifest | null,
): ModelLayerAvailabilityIndex['models'][string] {
  return {
    label,
    latest: manifest == null ? null : createAvailabilityLatestFixture(manifest),
  }
}

function createAvailabilityArtifactFixture(
  artifact: ManifestArtifactSpec
): AvailabilityManifestArtifactSpec {
  const { frames, ...artifactWithoutFrames } = artifact
  const firstFrame = Object.values(frames)[0]
  if (!firstFrame) {
    throw new Error(`Cannot create availability artifact fixture without frames: ${artifact.id}`)
  }

  return {
    ...artifactWithoutFrames,
    byteLength: firstFrame.byteLength,
  } as AvailabilityManifestArtifactSpec
}

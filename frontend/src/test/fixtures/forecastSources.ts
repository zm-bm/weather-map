import type {
  ContourSource,
  ForecastLayerSource,
  ParticleSource,
} from '@/forecast/catalog/source'
import {
  getDisplayProfile,
  type DisplayProfileId,
  type ForecastDisplayProfile,
} from '@/forecast/display'

type OverlaySource = ForecastLayerSource['overlays'][number]

export function createContourSourceFixture(
  overrides: Partial<ContourSource> & { artifactId?: string } = {}
): ContourSource {
  const { artifactId, ...sourceOverrides } = overrides
  return {
    id: 'pressure_contours',
    source: {
      artifactId: artifactId ?? 'prmsl_msl',
      bands: [{ id: 'value' }],
    },
    ...sourceOverrides,
  }
}

export function createOverlaySourceFixture(
  overrides: Partial<OverlaySource> & { artifactId?: string } = {}
): OverlaySource {
  const { artifactId, ...sourceOverrides } = overrides
  return {
    id: 'precipitation_type',
    style: 'precipitation-type-pattern',
    source: {
      artifactId: artifactId ?? 'precip_type_surface',
      bands: [{ id: 'snow_frac' }, { id: 'mix_frac' }],
    },
    optional: true,
    ...sourceOverrides,
  }
}

export function createRasterLayerSourceFixture(args: {
  layerId?: string
  artifactId?: string
  bands?: ForecastLayerSource['bands']
  display?: ForecastDisplayProfile
  displayProfile?: DisplayProfileId
  overlays?: readonly OverlaySource[]
} = {}): ForecastLayerSource {
  const layerId = args.layerId ?? 'temperature'
  return {
    layerId,
    artifactId: args.artifactId ?? 'tmp_surface',
    display: args.display ?? getDisplayProfile(args.displayProfile ?? displayProfileForLayerId(layerId)),
    overlays: args.overlays ?? [],
    bands: args.bands ?? [{ id: 'value' }],
  }
}

export function createCloudLayersLayerSourceFixture(args: {
  layerId?: string
  artifactId?: string
  display?: ForecastDisplayProfile
  overlays?: readonly OverlaySource[]
} = {}): ForecastLayerSource {
  return {
    layerId: args.layerId ?? 'cloud_layers',
    artifactId: args.artifactId ?? 'cloud_layers',
    display: args.display ?? getDisplayProfile('cloud-layers'),
    overlays: args.overlays ?? [],
    bands: [
      { id: 'low' },
      { id: 'middle' },
      { id: 'high' },
    ],
  }
}

export function createParticleSourceFixture(
  overrides: Partial<ParticleSource> & { artifactId?: string } = {}
): ParticleSource {
  const { artifactId, ...sourceOverrides } = overrides
  return {
    id: 'wind',
    source: {
      artifactId: artifactId ?? 'wind10m_uv',
      bands: [{ id: 'u' }, { id: 'v' }],
    },
    ...sourceOverrides,
  }
}

function displayProfileForLayerId(layerId: string): DisplayProfileId {
  if (layerId === 'relative_humidity') return 'relative-humidity'
  if (layerId === 'wind_speed') return 'wind-speed'
  if (layerId === 'wind_gust') return 'wind-gust'
  if (layerId === 'cloud_layers') return 'cloud-layers'
  if (layerId === 'snow_depth') return 'snow-depth'
  if (layerId === 'precipitation_rate') return 'precipitation-rate'
  return 'temperature'
}

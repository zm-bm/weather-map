import type {
  ContourSource,
  DisplayRange,
  ForecastLayerSource,
  ParticleSource,
} from '@/forecast/catalog/source'

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
  paletteId?: string
  displayRange?: DisplayRange
  artifactId?: string
  bands?: ForecastLayerSource['bands']
  overlays?: readonly OverlaySource[]
} = {}): ForecastLayerSource {
  const paletteId = args.paletteId ?? 'temperature.air.c.v1'
  return {
    layerId: args.layerId ?? 'temperature',
    artifactId: args.artifactId ?? 'tmp_surface',
    displayRange: args.displayRange ?? { min: -35, max: 50 },
    overlays: args.overlays ?? [],
    bands: args.bands ?? [{ id: 'value', paletteId }],
  }
}

export function createCloudLayersRasterSourceFixture(args: {
  layerId?: string
  displayRange?: DisplayRange
  artifactId?: string
  overlays?: readonly OverlaySource[]
} = {}): ForecastLayerSource {
  return {
    layerId: args.layerId ?? 'cloud_layers',
    artifactId: args.artifactId ?? 'cloud_layers',
    displayRange: args.displayRange ?? { min: 0, max: 100 },
    overlays: args.overlays ?? [],
    bands: [
      { id: 'low', paletteId: 'cloud.layers.low.v1' },
      { id: 'middle', paletteId: 'cloud.layers.middle.v1' },
      { id: 'high', paletteId: 'cloud.layers.high.v1' },
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

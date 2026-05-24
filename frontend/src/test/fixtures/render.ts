import type { Map as MapLibreMap } from 'maplibre-gl'
import { vi } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  type ForecastRenderSettings,
} from '@/forecast/settings'

const FORECAST_LAYER_BEFORE_ID_FIXTURE = 'coastline'

type RenderRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: unknown
  ) => void
  onRemove: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createRenderSettingsFixture(
  overrides: Partial<ForecastRenderSettings> = {}
): ForecastRenderSettings {
  return {
    field: DEFAULT_FIELD_RENDER_SETTINGS,
    particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
    ...overrides,
  }
}

export type RenderLayerMapFixture = MapLibreMap & {
  addLayer: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  removeLayer: ReturnType<typeof vi.fn>
}

export function createRenderLayerMapFixture(args: {
  layerIds?: readonly string[]
  includeAnchorLayer?: boolean
} = {}): RenderLayerMapFixture {
  const layers = new Set<string>(args.layerIds ?? [])
  if (args.includeAnchorLayer !== false) {
    layers.add(FORECAST_LAYER_BEFORE_ID_FIXTURE)
  }

  return {
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id)
      return undefined
    }),
    getLayer: vi.fn((layerId: string) => (
      layers.has(layerId) ? { id: layerId } : undefined
    )),
    removeLayer: vi.fn((layerId: string) => {
      layers.delete(layerId)
      return undefined
    }),
  } as unknown as RenderLayerMapFixture
}

export function createRenderRuntimeFixture(
  overrides: Partial<RenderRuntime> = {}
): RenderRuntime {
  return {
    onAdd: vi.fn(),
    render: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  }
}

export function createRenderControllerFixture(args: {
  available?: boolean
  applyFrame?: (frame: unknown) => void
  setEnabled?: (enabled: boolean) => void
  applySettings?: (settings: unknown) => void
} = {}) {
  const applyFrame = args.applyFrame ?? (() => undefined)
  const setEnabled = args.setEnabled ?? (() => undefined)
  const applySettings = args.applySettings ?? (() => undefined)

  return {
    isAvailable: () => args.available ?? true,
    applyFrame(frame: unknown) {
      applyFrame(frame)
    },
    setEnabled(enabled: boolean) {
      setEnabled(enabled)
    },
    applySettings(settings: unknown) {
      applySettings(settings)
    },
  }
}

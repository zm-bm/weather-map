import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRasterWindowFixture,
  createForecastWindowsFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createCustomLayerRuntimeFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../../maplibre/customLayer'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import { rasterAdapter } from './adapter'
import type { RasterController } from './runtime'

const mocks = vi.hoisted(() => ({
  createRasterRuntime: vi.fn(),
}))

vi.mock('./runtime', () => ({
  createRasterRuntime: mocks.createRasterRuntime,
}))

describe('rasterAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs the raster custom layer', () => {
    const renderSettings = createRenderSettingsFixture()
    mocks.createRasterRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
    const map = createRenderLayerMapFixture()

    rasterAdapter.install(map, renderSettings)

    expect(mocks.createRasterRuntime).toHaveBeenCalledWith(expect.any(Object), renderSettings.raster)
    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('forecast-raster-layer')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = createRenderLayerMapFixture({ layerIds: ['forecast-raster-layer'] })

    rasterAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createRasterRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded raster interpolation window to the runtime controller', () => {
    const frame = createRasterWindowFixture()
    const applyFrame = vi.fn()
    const map = createRenderLayerMapFixture()
    const unregister = registerRasterControllerFixture(map, createRenderControllerFixture({ applyFrame }))

    try {
      rasterAdapter.apply(map, createForecastWindowsFixture({
        raster: frame,
        particles: null,
      }))
    } finally {
      unregister()
    }

    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', () => {
    const map = createRenderLayerMapFixture()
    const unregister = registerRasterControllerFixture(map, createRenderControllerFixture({ available: false }))

    try {
      expect(() => rasterAdapter.apply(map, createForecastWindowsFixture({
        raster: createRasterWindowFixture(),
        particles: null,
      })))
        .toThrow('Raster renderer unavailable (WebGL2 required)')
    } finally {
      unregister()
    }
  })

  it('ignores empty raster frames when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    const map = createRenderLayerMapFixture()
    const unregister = registerRasterControllerFixture(map, createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    try {
      rasterAdapter.apply(map, {})
    } finally {
      unregister()
    }

    expect(applyFrame).not.toHaveBeenCalled()
  })

  it('applies render settings to the raster controller', () => {
    const applySettings = vi.fn()
    const map = createRenderLayerMapFixture()
    const settings = { colorSamplingMode: 'interpolated', opacity: 0.75 } as const
    const unregister = registerRasterControllerFixture(map, createRenderControllerFixture({ applySettings }))

    try {
      rasterAdapter.configure?.(map, {
        ...createRenderSettingsFixture(),
        raster: settings,
      })
    } finally {
      unregister()
    }

    expect(applySettings).toHaveBeenCalledWith(settings)
  })
})

function registerRasterControllerFixture(
  map: ReturnType<typeof createRenderLayerMapFixture>,
  controller: RasterController,
): () => void {
  mocks.createRasterRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
  rasterAdapter.install(map, createRenderSettingsFixture())
  const lifecycle = mocks.createRasterRuntime.mock.calls.at(-1)?.[0] as
    | RenderControllerLifecycle<RasterController>
    | undefined
  if (!lifecycle) throw new Error('Expected raster controller lifecycle')
  lifecycle.register(map, controller)
  return () => lifecycle.unregister(map)
}

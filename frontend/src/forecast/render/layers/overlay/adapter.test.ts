import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOverlayWindowFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createCustomLayerRuntimeFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../../maplibre/customLayer'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import { overlayAdapter } from './adapter'
import type { OverlayController } from './runtime'

const mocks = vi.hoisted(() => ({
  createOverlayRuntime: vi.fn(),
}))

vi.mock('./runtime', () => ({
  createOverlayRuntime: mocks.createOverlayRuntime,
}))

describe('overlayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs the overlay custom layer', () => {
    mocks.createOverlayRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
    const map = createRenderLayerMapFixture()

    overlayAdapter.install(map, createRenderSettingsFixture())

    expect(mocks.createOverlayRuntime).toHaveBeenCalled()
    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('forecast-overlay-layer')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('applies nullable overlay windows to the runtime controller', () => {
    const applyFrame = vi.fn()
    const frame = createOverlayWindowFixture()
    const map = createRenderLayerMapFixture()
    const unregister = registerOverlayControllerFixture(map, createRenderControllerFixture({ applyFrame }))

    try {
      overlayAdapter.apply(map, { overlay: frame })
      overlayAdapter.apply(map, {})
    } finally {
      unregister()
    }

    expect(applyFrame).toHaveBeenNthCalledWith(1, frame)
    expect(applyFrame).toHaveBeenNthCalledWith(2, null)
  })

  it('no-ops when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    const map = createRenderLayerMapFixture()
    const unregister = registerOverlayControllerFixture(map, createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    try {
      overlayAdapter.apply(map, { overlay: createOverlayWindowFixture() })
    } finally {
      unregister()
    }

    expect(applyFrame).not.toHaveBeenCalled()
  })
})

function registerOverlayControllerFixture(
  map: ReturnType<typeof createRenderLayerMapFixture>,
  controller: OverlayController,
): () => void {
  mocks.createOverlayRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
  overlayAdapter.install(map, createRenderSettingsFixture())
  const lifecycle = mocks.createOverlayRuntime.mock.calls.at(-1)?.[0] as
    | RenderControllerLifecycle<OverlayController>
    | undefined
  if (!lifecycle) throw new Error('Expected overlay controller lifecycle')
  lifecycle.register(map, controller)
  return () => lifecycle.unregister(map)
}

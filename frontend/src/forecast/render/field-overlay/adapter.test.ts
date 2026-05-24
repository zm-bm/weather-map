import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPrecipTypeWindowFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createRenderRuntimeFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import {
  applyPrecipTypeOverlayInterpolationWindow,
  fieldOverlayAdapter,
} from './adapter'

const mocks = vi.hoisted(() => ({
  getFieldOverlayController: vi.fn(),
  createFieldOverlayRuntime: vi.fn(),
}))

vi.mock('./controller', () => ({
  getFieldOverlayController: mocks.getFieldOverlayController,
}))

vi.mock('./engine/runtime', () => ({
  createFieldOverlayRuntime: mocks.createFieldOverlayRuntime,
}))

describe('fieldOverlayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFieldOverlayController.mockReturnValue(createRenderControllerFixture())
  })

  it('installs the field overlay custom layer', () => {
    mocks.createFieldOverlayRuntime.mockReturnValue(createRenderRuntimeFixture())
    const map = createRenderLayerMapFixture()

    fieldOverlayAdapter.install(map, createRenderSettingsFixture())

    expect(mocks.createFieldOverlayRuntime).toHaveBeenCalled()
    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('field-overlay-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('applies nullable overlay windows to the runtime controller', () => {
    const applyFrame = vi.fn()
    const frame = createPrecipTypeWindowFixture()
    mocks.getFieldOverlayController.mockReturnValue(createRenderControllerFixture({ applyFrame }))

    applyPrecipTypeOverlayInterpolationWindow(createRenderLayerMapFixture(), frame)
    applyPrecipTypeOverlayInterpolationWindow(createRenderLayerMapFixture(), null)

    expect(applyFrame).toHaveBeenNthCalledWith(1, frame)
    expect(applyFrame).toHaveBeenNthCalledWith(2, null)
  })

  it('no-ops when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    mocks.getFieldOverlayController.mockReturnValue(createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    applyPrecipTypeOverlayInterpolationWindow(createRenderLayerMapFixture(), createPrecipTypeWindowFixture())

    expect(applyFrame).not.toHaveBeenCalled()
  })
})

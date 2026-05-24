import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createFieldWindowFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createRenderRuntimeFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import { applyFieldInterpolationWindow, applyFieldRenderSettings, fieldAdapter } from './adapter'

const mocks = vi.hoisted(() => ({
  getFieldController: vi.fn(),
  createFieldRuntime: vi.fn(),
}))

vi.mock('./controller', () => ({
  getFieldController: mocks.getFieldController,
}))

vi.mock('./engine/runtime', () => ({
  createFieldRuntime: mocks.createFieldRuntime,
}))

describe('fieldAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFieldController.mockReturnValue(createRenderControllerFixture())
  })

  it('installs the field custom layer', () => {
    const renderSettings = createRenderSettingsFixture()
    mocks.createFieldRuntime.mockReturnValue(createRenderRuntimeFixture())
    const map = createRenderLayerMapFixture()

    fieldAdapter.install(map, renderSettings)

    expect(mocks.createFieldRuntime).toHaveBeenCalledWith(renderSettings.field)
    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('field-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = createRenderLayerMapFixture({ layerIds: ['field-renderer-layer-id'] })

    fieldAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createFieldRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded field interpolation window to the runtime controller', () => {
    const frame = createFieldWindowFixture()
    const applyFrame = vi.fn()
    const map = createRenderLayerMapFixture()
    mocks.getFieldController.mockReturnValue(createRenderControllerFixture({ applyFrame }))

    applyFieldInterpolationWindow(map, frame)

    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getFieldController.mockReturnValue(createRenderControllerFixture({ available: false }))

    expect(() => applyFieldInterpolationWindow(createRenderLayerMapFixture(), createFieldWindowFixture()))
      .toThrow('Field renderer unavailable (WebGL2 required)')
  })

  it('ignores empty field frames when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    mocks.getFieldController.mockReturnValue(createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    applyFieldInterpolationWindow(createRenderLayerMapFixture(), null)

    expect(applyFrame).not.toHaveBeenCalled()
  })

  it('applies render settings to the field controller', () => {
    const applySettings = vi.fn()
    const map = createRenderLayerMapFixture()
    const settings = { colorSamplingMode: 'interpolated' } as const
    mocks.getFieldController.mockReturnValue(createRenderControllerFixture({ applySettings }))

    applyFieldRenderSettings(map, settings)

    expect(applySettings).toHaveBeenCalledWith(settings)
  })
})

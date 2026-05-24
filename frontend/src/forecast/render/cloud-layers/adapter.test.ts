import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createCloudLayersWindowFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createRenderRuntimeFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import { applyCloudLayersInterpolationWindow, cloudLayersAdapter } from './adapter'

const mocks = vi.hoisted(() => ({
  getCloudLayersController: vi.fn(),
  createCloudLayersRuntime: vi.fn(),
}))

vi.mock('./controller', () => ({
  getCloudLayersController: mocks.getCloudLayersController,
}))

vi.mock('./runtime', () => ({
  createCloudLayersRuntime: mocks.createCloudLayersRuntime,
}))

describe('cloudLayersAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudLayersController.mockReturnValue(createRenderControllerFixture())
  })

  it('installs the cloud layers custom layer', () => {
    mocks.createCloudLayersRuntime.mockReturnValue(createRenderRuntimeFixture())
    const map = createRenderLayerMapFixture()

    cloudLayersAdapter.install(map, createRenderSettingsFixture())

    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('cloud-layers-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = createRenderLayerMapFixture({ layerIds: ['cloud-layers-renderer-layer-id'] })

    cloudLayersAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createCloudLayersRuntime).not.toHaveBeenCalled()
  })

  it('applies and clears cloud layers frames through the runtime controller', () => {
    const frame = createCloudLayersWindowFixture()
    const applyFrame = vi.fn()
    const map = createRenderLayerMapFixture()
    mocks.getCloudLayersController.mockReturnValue(createRenderControllerFixture({ applyFrame }))

    applyCloudLayersInterpolationWindow(map, frame)
    applyCloudLayersInterpolationWindow(map, null)

    expect(applyFrame).toHaveBeenNthCalledWith(1, frame)
    expect(applyFrame).toHaveBeenNthCalledWith(2, null)
  })

  it('throws when runtime is unavailable and a cloud frame is present', () => {
    mocks.getCloudLayersController.mockReturnValue(createRenderControllerFixture({ available: false }))

    expect(() => applyCloudLayersInterpolationWindow(createRenderLayerMapFixture(), createCloudLayersWindowFixture()))
      .toThrow('Cloud Layers renderer unavailable (WebGL2 required)')
  })

  it('ignores empty cloud frames when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    mocks.getCloudLayersController.mockReturnValue(createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    applyCloudLayersInterpolationWindow(createRenderLayerMapFixture(), null)

    expect(applyFrame).not.toHaveBeenCalled()
  })
})

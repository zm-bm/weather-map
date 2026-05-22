import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
} from '../../forecast-settings/settings'
import { FORECAST_LAYER_BEFORE_ID } from '../placement'
import { applyCloudLayersInterpolationWindow, cloudLayersRenderer } from './adapter'

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}

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

describe('cloudLayersRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudLayersController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })
  })

  it('installs the cloud layers custom layer', () => {
    mocks.createCloudLayersRuntime.mockReturnValue({
      onAdd: vi.fn(),
      render: vi.fn(),
      onRemove: vi.fn(),
    })
    const addLayer = vi.fn()
    const map = {
      getLayer: vi.fn((layerId: string) => (
        layerId === FORECAST_LAYER_BEFORE_ID ? { id: FORECAST_LAYER_BEFORE_ID } : undefined
      )),
      addLayer,
    }

    cloudLayersRenderer.install(map as never, DEFAULT_RENDER_SETTINGS)

    const [layer, beforeId] = addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('cloud-layers-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = {
      getLayer: vi.fn(() => ({ id: 'cloud-layers-renderer-layer-id' })),
      addLayer: vi.fn(),
    }

    cloudLayersRenderer.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createCloudLayersRuntime).not.toHaveBeenCalled()
  })

  it('applies and clears cloud layers frames through the runtime controller', () => {
    const frame = { lower: { layerId: 'cloud_layers' } }
    const applyFrame = vi.fn()
    const map = {}
    mocks.getCloudLayersController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    applyCloudLayersInterpolationWindow(map as never, frame as never)
    applyCloudLayersInterpolationWindow(map as never, null)

    expect(applyFrame).toHaveBeenNthCalledWith(1, frame)
    expect(applyFrame).toHaveBeenNthCalledWith(2, null)
  })

  it('throws when runtime is unavailable and a cloud frame is present', () => {
    mocks.getCloudLayersController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })

    expect(() => applyCloudLayersInterpolationWindow({} as never, { lower: { layerId: 'cloud_layers' } } as never))
      .toThrow('Cloud Layers renderer unavailable (WebGL2 required)')
  })
})

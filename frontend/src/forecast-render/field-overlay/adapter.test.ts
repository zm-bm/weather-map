import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
} from '../../forecast-settings/settings'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import {
  applyPrecipTypeOverlayInterpolationWindow,
  fieldOverlayAdapter,
} from './adapter'

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}

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
    mocks.getFieldOverlayController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })
  })

  it('installs the field overlay custom layer', () => {
    mocks.createFieldOverlayRuntime.mockReturnValue({
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

    fieldOverlayAdapter.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(mocks.createFieldOverlayRuntime).toHaveBeenCalled()
    const [layer, beforeId] = addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('field-overlay-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('applies nullable overlay windows to the runtime controller', () => {
    const applyFrame = vi.fn()
    const frame = { lower: { artifactId: 'precip_type_surface' } }
    mocks.getFieldOverlayController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    applyPrecipTypeOverlayInterpolationWindow({} as never, frame as never)
    applyPrecipTypeOverlayInterpolationWindow({} as never, null)

    expect(applyFrame).toHaveBeenNthCalledWith(1, frame)
    expect(applyFrame).toHaveBeenNthCalledWith(2, null)
  })

  it('no-ops when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    mocks.getFieldOverlayController.mockReturnValue({
      isAvailable: () => false,
      applyFrame,
      setEnabled: vi.fn(),
    })

    applyPrecipTypeOverlayInterpolationWindow({} as never, { lower: {} } as never)

    expect(applyFrame).not.toHaveBeenCalled()
  })
})

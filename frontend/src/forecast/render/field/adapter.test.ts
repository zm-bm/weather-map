import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
} from '@/forecast/settings/settings'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import { applyFieldInterpolationWindow, applyFieldRenderSettings, fieldAdapter } from './adapter'

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}

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
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
      applySettings: vi.fn(),
    })
  })

  it('installs the field custom layer', () => {
    mocks.createFieldRuntime.mockReturnValue({
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

    fieldAdapter.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(mocks.createFieldRuntime).toHaveBeenCalledWith(DEFAULT_RENDER_SETTINGS.field)
    const [layer, beforeId] = addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('field-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = {
      getLayer: vi.fn(() => ({ id: 'field-renderer-layer-id' })),
      addLayer: vi.fn(),
    }

    fieldAdapter.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createFieldRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded field interpolation window to the runtime controller', () => {
    const frame = { lower: { layerId: 'temperature' } }
    const applyFrame = vi.fn()
    const map = {}
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
      applySettings: vi.fn(),
    })

    applyFieldInterpolationWindow(map as never, frame as never)

    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
      applySettings: vi.fn(),
    })

    expect(() => applyFieldInterpolationWindow({} as never, { lower: { layerId: 'temperature' } } as never))
      .toThrow('Field renderer unavailable (WebGL2 required)')
  })

  it('ignores empty field frames when runtime is unavailable', () => {
    const applyFrame = vi.fn()
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => false,
      applyFrame,
      setEnabled: vi.fn(),
      applySettings: vi.fn(),
    })

    applyFieldInterpolationWindow({} as never, null)

    expect(applyFrame).not.toHaveBeenCalled()
  })

  it('applies render settings to the field controller', () => {
    const applySettings = vi.fn()
    const map = {}
    const settings = { colorSamplingMode: 'interpolated' } as const
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
      applySettings,
    })

    applyFieldRenderSettings(map as never, settings)

    expect(applySettings).toHaveBeenCalledWith(settings)
  })
})

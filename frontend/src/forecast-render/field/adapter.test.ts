import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FORECAST_LAYER_BEFORE_ID } from '../types'
import { applyFieldFrame, fieldRenderer } from './adapter'
import { fieldRuntimeOptions } from './options'

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

describe('fieldRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
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
      getLayer: vi.fn(() => undefined),
      addLayer,
    }

    fieldRenderer.install(map as never)

    expect(mocks.createFieldRuntime).toHaveBeenCalledWith(fieldRuntimeOptions)
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

    fieldRenderer.install(map as never)

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createFieldRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded field frame to the runtime controller', () => {
    const frame = { lower: { layerId: 'tmp_surface' } }
    const applyFrame = vi.fn()
    const map = {}
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    applyFieldFrame(map as never, frame as never)

    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getFieldController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })

    expect(() => applyFieldFrame({} as never, { lower: { layerId: 'tmp_surface' } } as never))
      .toThrow('Field renderer unavailable (WebGL2 required)')
  })
})

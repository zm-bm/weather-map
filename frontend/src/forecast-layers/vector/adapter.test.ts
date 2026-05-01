import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FORECAST_LAYER_BEFORE_ID } from '../types'
import { applyVectorFrame, vectorLayerAdapter } from './adapter'
import { vectorRuntimeOptions } from './options'

const mocks = vi.hoisted(() => ({
  getVectorController: vi.fn(),
  createVectorRuntime: vi.fn(),
}))

vi.mock('./controller', () => ({
  getVectorController: mocks.getVectorController,
}))

vi.mock('./engine/runtime', () => ({
  createVectorRuntime: mocks.createVectorRuntime,
}))

describe('vectorLayerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVectorController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })
  })

  it('installs the vector custom layer', () => {
    mocks.createVectorRuntime.mockReturnValue({
      onAdd: vi.fn(),
      render: vi.fn(),
      onRemove: vi.fn(),
    })
    const addLayer = vi.fn()
    const map = {
      getLayer: vi.fn(() => undefined),
      addLayer,
    }

    vectorLayerAdapter.install(map as never)

    expect(mocks.createVectorRuntime).toHaveBeenCalledWith(vectorRuntimeOptions)
    const [layer, beforeId] = addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('vector-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = {
      getLayer: vi.fn(() => ({ id: 'vector-layer-id' })),
      addLayer: vi.fn(),
    }

    vectorLayerAdapter.install(map as never)

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createVectorRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded vector frame to the runtime controller', () => {
    const frame = { lower: { metadata: { variableId: 'wind10m_uv' } } }
    const applyFrame = vi.fn()
    const map = {}
    mocks.getVectorController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    applyVectorFrame(map as never, frame as never)

    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getVectorController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })

    expect(() => applyVectorFrame({} as never, { lower: { metadata: { variableId: 'wind10m_uv' } } } as never))
      .toThrow('Vector runtime unavailable (WebGL2 required)')
  })
})

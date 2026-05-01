import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FORECAST_LAYER_BEFORE_ID } from '../types'
import { applyScalarFrame, scalarLayerAdapter } from './adapter'
import { scalarRuntimeOptions } from './options'

const mocks = vi.hoisted(() => ({
  getScalarController: vi.fn(),
  createScalarRuntime: vi.fn(),
}))

vi.mock('./controller', () => ({
  getScalarController: mocks.getScalarController,
}))

vi.mock('./engine/runtime', () => ({
  createScalarRuntime: mocks.createScalarRuntime,
}))

describe('scalarLayerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getScalarController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })
  })

  it('installs the scalar custom layer', () => {
    mocks.createScalarRuntime.mockReturnValue({
      onAdd: vi.fn(),
      render: vi.fn(),
      onRemove: vi.fn(),
    })
    const addLayer = vi.fn()
    const map = {
      getLayer: vi.fn(() => undefined),
      addLayer,
    }

    scalarLayerAdapter.install(map as never)

    expect(mocks.createScalarRuntime).toHaveBeenCalledWith(scalarRuntimeOptions)
    const [layer, beforeId] = addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('scalar-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = {
      getLayer: vi.fn(() => ({ id: 'scalar-layer-id' })),
      addLayer: vi.fn(),
    }

    scalarLayerAdapter.install(map as never)

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createScalarRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded scalar frame to the runtime controller', () => {
    const frame = { lower: { variableId: 'tmp_surface' } }
    const applyFrame = vi.fn()
    const map = {}
    mocks.getScalarController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    applyScalarFrame(map as never, frame as never)

    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getScalarController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })

    expect(() => applyScalarFrame({} as never, { lower: { variableId: 'tmp_surface' } } as never))
      .toThrow('Scalar runtime unavailable (WebGL2 required)')
  })
})

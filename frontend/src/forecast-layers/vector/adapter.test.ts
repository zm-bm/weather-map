import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asVectorVariableId } from '../../manifest'
import { FORECAST_LAYER_BEFORE_ID } from '../types'
import { vectorLayerAdapter } from './adapter'
import { vectorRuntimeOptions } from './options'
import {
  createConfigFixture,
  createManifestFixture,
  createMapFixture,
  createSignalFixture,
} from '../../test/fixtures'

const mocks = vi.hoisted(() => ({
  loadVectorFrameWindow: vi.fn(),
  getVectorController: vi.fn(),
  createVectorRuntime: vi.fn(),
}))

vi.mock('./engine/frame', () => ({
  loadVectorFrameWindow: mocks.loadVectorFrameWindow,
}))

vi.mock('./controller', () => ({
  getVectorController: mocks.getVectorController,
}))

vi.mock('./engine/runtime', () => ({
  createVectorRuntime: mocks.createVectorRuntime,
}))

function createArgs(
  signal: AbortSignal,
  manifest = createManifestFixture({ forecastHours: ['000'] })
) {
  return {
    map: createMapFixture(),
    config: createConfigFixture(),
    manifest,
    selectedValidTimeMs: 0,
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: 0,
    activeScalar: manifest.scalarVariables[0],
    activeVector: manifest.vectorVariables[0],
    signal,
  }
}

describe('vectorLayerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadVectorFrameWindow.mockResolvedValue({ lower: { metadata: { variableId: 'wind10m_uv' } } })
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

  it('loads and applies the active vector', async () => {
    const frame = { lower: { metadata: { variableId: 'wind10m_uv' } } }
    const applyFrame = vi.fn()

    mocks.loadVectorFrameWindow.mockResolvedValue(frame)
    mocks.getVectorController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    await vectorLayerAdapter.applySync!(createArgs(createSignalFixture()))

    expect(mocks.loadVectorFrameWindow).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'wind10m_uv' })
    )
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('reuses the previous frame window for the same map and vector', async () => {
    const map = createMapFixture()
    const firstFrame = {
      lower: { metadata: { variableId: 'wind10m_uv' } },
      upper: { metadata: { variableId: 'wind10m_uv' } },
    }
    const secondFrame = {
      lower: { metadata: { variableId: 'wind10m_uv' } },
      upper: { metadata: { variableId: 'wind10m_uv' } },
    }
    mocks.loadVectorFrameWindow
      .mockResolvedValueOnce(firstFrame)
      .mockResolvedValueOnce(secondFrame)

    await vectorLayerAdapter.applySync!({
      ...createArgs(createSignalFixture()),
      map,
      lowerHourToken: '000',
      upperHourToken: '001',
      mix: 0.5,
    })
    await vectorLayerAdapter.applySync!({
      ...createArgs(createSignalFixture()),
      map,
      lowerHourToken: '001',
      upperHourToken: '002',
      mix: 0.25,
    })

    expect(mocks.loadVectorFrameWindow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ previousWindow: null })
    )
    expect(mocks.loadVectorFrameWindow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ previousWindow: firstFrame })
    )
  })

  it('forwards the requested active vector id', async () => {
    const frame = { lower: { metadata: { variableId: 'gust10m_uv' } } }
    const applyFrame = vi.fn()
    mocks.loadVectorFrameWindow.mockResolvedValue(frame)
    mocks.getVectorController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    await vectorLayerAdapter.applySync!({
      ...createArgs(createSignalFixture()),
      activeVector: asVectorVariableId('gust10m_uv'),
    })

    expect(mocks.loadVectorFrameWindow).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'gust10m_uv' })
    )
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', async () => {
    mocks.loadVectorFrameWindow.mockResolvedValue({ lower: { metadata: { variableId: 'wind10m_uv' } } })
    mocks.getVectorController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
    })

    await expect(vectorLayerAdapter.applySync!(createArgs(createSignalFixture())))
      .rejects.toThrow('Vector runtime unavailable (WebGL2 required)')
  })
})

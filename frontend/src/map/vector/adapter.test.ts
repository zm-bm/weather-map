import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asVectorVariableId } from '../manifest'
import { vectorLayerAdapter } from './adapter'
import {
  createConfigFixture,
  createManifestFixture,
  createMapFixture,
  createSignalFixture,
} from '../../test/fixtures'

const mocks = vi.hoisted(() => ({
  loadVectorFrame: vi.fn(),
  getVectorRuntimeController: vi.fn(),
  createVectorRuntime: vi.fn(),
}))

vi.mock('./engine/frame', () => ({
  loadVectorFrame: mocks.loadVectorFrame,
}))

vi.mock('./engine/runtime', () => ({
  getVectorRuntimeController: mocks.getVectorRuntimeController,
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
    hourToken: '000',
    activeScalar: manifest.scalarVariables[0],
    activeVector: manifest.vectorVariables[0],
    signal,
  }
}

describe('vectorLayerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadVectorFrame.mockResolvedValue({ metadata: { variableId: 'wind10m_uv' } })
    mocks.getVectorRuntimeController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
    })
  })

  it('creates a custom layer with the vector layer id', () => {
    mocks.createVectorRuntime.mockReturnValue({
      onAdd: vi.fn(),
      render: vi.fn(),
      onRemove: vi.fn(),
    })

    const layer = vectorLayerAdapter.createLayer()

    expect(layer.id).toBe('vector-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
  })

  it('loads and applies the active vector', async () => {
    const frame = { metadata: { variableId: 'wind10m_uv' } }
    const applyFrame = vi.fn()

    mocks.loadVectorFrame.mockResolvedValue(frame)
    mocks.getVectorRuntimeController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
    })

    await vectorLayerAdapter.applySync(createArgs(createSignalFixture()))

    expect(mocks.loadVectorFrame).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'wind10m_uv' })
    )
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('forwards the requested active vector id', async () => {
    const frame = { metadata: { variableId: 'gust10m_uv' } }
    const applyFrame = vi.fn()
    mocks.loadVectorFrame.mockResolvedValue(frame)
    mocks.getVectorRuntimeController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
    })

    await vectorLayerAdapter.applySync({
      ...createArgs(createSignalFixture()),
      activeVector: asVectorVariableId('gust10m_uv'),
    })

    expect(mocks.loadVectorFrame).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'gust10m_uv' })
    )
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', async () => {
    mocks.loadVectorFrame.mockResolvedValue({ metadata: { variableId: 'wind10m_uv' } })
    mocks.getVectorRuntimeController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
    })

    await expect(vectorLayerAdapter.applySync(createArgs(createSignalFixture())))
      .rejects.toThrow('Vector runtime unavailable (WebGL2 required)')
  })
})

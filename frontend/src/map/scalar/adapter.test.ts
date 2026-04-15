import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scalarLayerAdapter } from './adapter'
import {
  createConfigFixture,
  createManifestFixture,
  createMapFixture,
  createSignalFixture,
} from '../../test/fixtures'

const mocks = vi.hoisted(() => ({
  loadScalarFrame: vi.fn(),
  getScalarRuntimeController: vi.fn(),
  createScalarRuntime: vi.fn(),
}))

vi.mock('./engine/frame', () => ({
  loadScalarFrame: mocks.loadScalarFrame,
}))

vi.mock('./engine/runtime', () => ({
  getScalarRuntimeController: mocks.getScalarRuntimeController,
  createScalarRuntime: mocks.createScalarRuntime,
}))

function createArgs(signal: AbortSignal) {
  const manifest = createManifestFixture({ forecastHours: ['000'] })
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

describe('scalarLayerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadScalarFrame.mockResolvedValue({ variableId: 'tmp_surface' })
    mocks.getScalarRuntimeController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
    })
  })

  it('creates a custom layer with the scalar layer id', () => {
    mocks.createScalarRuntime.mockReturnValue({
      onAdd: vi.fn(),
      render: vi.fn(),
      onRemove: vi.fn(),
    })

    const layer = scalarLayerAdapter.createLayer()

    expect(layer.id).toBe('scalar-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
  })

  it('loads and applies a scalar frame for the active scalar', async () => {
    const frame = { variableId: 'tmp_surface' }
    const applyFrame = vi.fn()

    mocks.loadScalarFrame.mockResolvedValue(frame)
    mocks.getScalarRuntimeController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
    })

    await scalarLayerAdapter.applySync(createArgs(createSignalFixture()))

    expect(mocks.loadScalarFrame).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'tmp_surface' })
    )
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('throws when runtime is unavailable', async () => {
    mocks.loadScalarFrame.mockResolvedValue({ variableId: 'tmp_surface' })
    mocks.getScalarRuntimeController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
    })

    await expect(scalarLayerAdapter.applySync(createArgs(createSignalFixture())))
      .rejects.toThrow('Scalar runtime unavailable (WebGL2 required)')
  })

  it('throws abort when signal is aborted after load', async () => {
    const ac = new AbortController()
    const applyFrame = vi.fn()

    mocks.loadScalarFrame.mockImplementation(async () => {
      ac.abort()
      return { variableId: 'tmp_surface' }
    })
    mocks.getScalarRuntimeController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
    })

    await expect(scalarLayerAdapter.applySync(createArgs(ac.signal)))
      .rejects.toMatchObject({ name: 'AbortError' })

    expect(applyFrame).not.toHaveBeenCalled()
  })
})
